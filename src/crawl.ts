import { readSiteJson, writeSiteJson } from "./cache.js";
import { collectCandidates } from "./coverage.js";
import { analyzeHtml } from "./audit.js";
import { fetchText, extractLocs } from "./util/web.js";

/**
 * Direct-fetch recursive site crawler. Unlike coverage.ts (which inspects URLs
 * through the GSC URL-Inspection quota), this fetches the live site itself over
 * HTTP — no Google scope, no quota — and follows internal links to build a
 * site-wide picture: per-URL status, the FULL redirect chain (captured with a
 * manual-redirect loop, not the auto-following fetch), response headers
 * (so X-Robots-Tag is free), the parsed on-page signals, and the internal-link
 * graph. It seeds from the live /sitemap.xml + robots.txt Sitemap: directives +
 * homepage (so a fresh, never-submitted site isn't thin) unioned with the
 * GSC-derived candidate set when available. Bounded + resumable across calls so
 * long crawls advance in batches (mirrors refreshCoverage). Feeds site_audit and
 * crawl-aware diagnose_site. See ROADMAP §P1.
 */

const UA = "searchlight site crawler";
const CRAWL_CAP = 5000; // hard ceiling on total pages per site
const DEFAULT_MAX_PAGES = 150; // pages fetched per run (resumable)
const CONCURRENCY = 6;
const MAX_REDIRECT_HOPS = 8;

export interface RedirectHop {
  url: string;
  status: number;
  location: string | null;
}

export interface CrawlRecord {
  url: string; // the URL we requested (graph key)
  status: number; // final status (0 = fetch error)
  finalUrl: string; // where it ended after redirects
  redirectChain: RedirectHop[]; // hops before the final response ([] = direct)
  redirectLoop: boolean;
  contentType: string | null;
  xRobotsTag: string | null;
  title: string | null;
  canonical: string | null;
  metaRobots: string | null;
  noindex: boolean; // meta robots OR X-Robots-Tag
  nofollow: boolean;
  indexable: boolean; // 200 + not noindex + not robots-disallowed
  internalLinks: string[]; // normalized, same-site (crawl boundary), deduped
  externalLinkCount: number;
  depth: number;
  fetchedAt: string;
  error?: string;
}

export type CrawlCache = Record<string, CrawlRecord>;

interface CrawlState {
  seededAt?: string;
  lastRunAt?: string;
  done: boolean;
  frontier: { url: string; depth: number }[];
  /** Disallow rules (User-agent: *) keyed by origin host. */
  robots: Record<string, string[]>;
  origins: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- URL helpers ----------

function normalize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Same-site predicate. URL-prefix props => same host; domain props => host or any subdomain. */
function boundaryFor(siteUrl: string): (url: string) => boolean {
  if (siteUrl.startsWith("sc-domain:")) {
    const d = siteUrl.slice("sc-domain:".length).toLowerCase();
    return (url) => {
      const h = hostOf(url);
      return !!h && (h === d || h.endsWith("." + d));
    };
  }
  let host = "";
  try {
    host = new URL(siteUrl).host.toLowerCase();
  } catch {
    return () => false;
  }
  return (url) => hostOf(url) === host;
}

function originsFor(siteUrl: string): string[] {
  if (siteUrl.startsWith("sc-domain:")) {
    const d = siteUrl.slice("sc-domain:".length);
    return [`https://${d}`, `https://www.${d}`];
  }
  try {
    return [new URL(siteUrl).origin];
  } catch {
    return [];
  }
}

// ---------- robots.txt (simplified: User-agent: * group only) ----------

export interface Robots {
  disallow: string[];
  sitemaps: string[];
}

/** Minimal robots.txt parser: Disallow paths + Sitemap: directives for the `*` group. */
export function parseRobots(text: string): Robots {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let active = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (field === "user-agent") active = val === "*";
    else if (field === "sitemap") sitemaps.push(val);
    else if (field === "disallow" && active && val) disallow.push(val);
  }
  return { disallow, sitemaps };
}

function isDisallowed(url: string, robots: Record<string, string[]>): boolean {
  const h = hostOf(url);
  if (!h || !robots[h]?.length) return false;
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  // simple prefix match (wildcards not expanded — conservative on the disallow side)
  return robots[h].some((rule) => path.startsWith(rule.replace(/\*.*$/, "")));
}

// ---------- fetch helpers ----------

/** Fetch a sitemap (one level of sitemap-index expansion) and add same-site page URLs. */
async function addSitemap(sitemapUrl: string, into: Set<string>, inSite: (u: string) => boolean): Promise<void> {
  let xml: string;
  try {
    xml = await fetchText(sitemapUrl, UA);
  } catch {
    return;
  }
  const locs = extractLocs(xml);
  if (/<sitemapindex[\s>]/i.test(xml)) {
    for (const child of locs.slice(0, 50)) {
      let childXml: string;
      try {
        childXml = await fetchText(child, UA);
      } catch {
        continue;
      }
      for (const u of extractLocs(childXml)) if (inSite(u)) into.add(u);
    }
  } else {
    for (const u of locs) if (inSite(u)) into.add(u);
  }
}

interface FetchResult {
  status: number;
  finalUrl: string;
  chain: RedirectHop[];
  loop: boolean;
  contentType: string | null;
  xRobotsTag: string | null;
  body: string;
  error?: string;
}

/** Fetch a URL following redirects MANUALLY so the full hop chain is captured. */
async function fetchFollowing(url: string): Promise<FetchResult> {
  const chain: RedirectHop[] = [];
  let current = url;
  for (let i = 0; i <= MAX_REDIRECT_HOPS; i++) {
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "User-Agent": UA } });
    } catch (e) {
      return {
        status: 0,
        finalUrl: current,
        chain,
        loop: false,
        contentType: null,
        xRobotsTag: null,
        body: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
    const status = res.status;
    const contentType = res.headers.get("content-type");
    const xRobotsTag = res.headers.get("x-robots-tag");
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      chain.push({ url: current, status, location });
      const next = location ? normalize(location, current) : null;
      if (!next) return { status, finalUrl: current, chain, loop: false, contentType, xRobotsTag, body: "" };
      if (chain.some((h) => h.url === next) || chain.length > MAX_REDIRECT_HOPS) {
        return { status, finalUrl: next, chain, loop: true, contentType, xRobotsTag, body: "" };
      }
      current = next;
      continue;
    }
    const isHtml = !!contentType && contentType.includes("text/html");
    const body = isHtml ? await res.text().catch(() => "") : "";
    return { status, finalUrl: current, chain, loop: false, contentType, xRobotsTag, body };
  }
  return { status: 0, finalUrl: current, chain, loop: true, contentType: null, xRobotsTag: null, body: "" };
}

// ---------- per-URL processing ----------

function analyze(
  requestUrl: string,
  depth: number,
  fr: FetchResult,
  inSite: (u: string) => boolean
): CrawlRecord {
  const xr = (fr.xRobotsTag || "").toLowerCase();
  const rec: CrawlRecord = {
    url: requestUrl,
    status: fr.status,
    finalUrl: fr.finalUrl,
    redirectChain: fr.chain,
    redirectLoop: fr.loop,
    contentType: fr.contentType,
    xRobotsTag: fr.xRobotsTag,
    title: null,
    canonical: null,
    metaRobots: null,
    noindex: xr.includes("noindex"), // header applies even to non-HTML / non-200
    nofollow: xr.includes("nofollow"),
    indexable: false,
    internalLinks: [],
    externalLinkCount: 0,
    depth,
    fetchedAt: new Date().toISOString(),
    error: fr.error,
  };

  if (fr.status === 200 && fr.body) {
    // Same parser as auditPage. The crawler already skipped robots-disallowed
    // URLs before fetching, so robotsDisallowed is false for anything analyzed.
    const sig = analyzeHtml(fr.body, { url: fr.finalUrl, status: fr.status, xRobotsTag: fr.xRobotsTag });
    rec.title = sig.title;
    rec.canonical = sig.canonical;
    rec.metaRobots = sig.metaRobots;
    rec.noindex = sig.noindex;
    rec.nofollow = sig.nofollow;
    rec.indexable = sig.indexable;
    // Re-filter ALL links through the crawl boundary (broader than same-host for domain props).
    rec.internalLinks = sig.links.filter(inSite);
    rec.externalLinkCount = sig.links.length - rec.internalLinks.length;
  }
  return rec;
}

// ---------- public API ----------

export function loadCrawl(siteUrl: string): CrawlCache {
  return readSiteJson<CrawlCache>(siteUrl, "crawl.json", {});
}

export interface CrawlProgress {
  siteUrl: string;
  seededThisRun: boolean;
  crawledThisRun: number;
  totalCrawled: number;
  frontierRemaining: number;
  done: boolean;
  skippedByRobots: number;
  errors: number;
  statusCounts: Record<string, number>;
  redirectsFound: number;
  note: string;
}

export interface CrawlOptions {
  maxPages?: number; // pages to fetch THIS run
  reset?: boolean; // discard prior crawl + start fresh
}

/** Advance (or start) the crawl by up to maxPages this run. Resumable across calls. */
export async function crawlSite(siteUrl: string, opts: CrawlOptions = {}): Promise<CrawlProgress> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? DEFAULT_MAX_PAGES, CRAWL_CAP));
  const inSite = boundaryFor(siteUrl);

  let state = opts.reset
    ? null
    : readSiteJson<CrawlState | null>(siteUrl, "crawl-state.json", null);
  let cache: CrawlCache = opts.reset ? {} : loadCrawl(siteUrl);

  let seededThisRun = false;
  if (!state || !state.seededAt) {
    // --- seed: direct (homepage + sitemap + robots Sitemap:) ∪ GSC candidates ---
    const seeds = new Set<string>();
    const robots: Record<string, string[]> = {};
    const origins = originsFor(siteUrl);
    for (const o of origins) {
      seeds.add(o + "/");
      const host = hostOf(o) ?? o;
      try {
        const txt = await fetchText(o + "/robots.txt", UA);
        const pr = parseRobots(txt);
        robots[host] = pr.disallow;
        for (const sm of pr.sitemaps) await addSitemap(sm, seeds, inSite);
      } catch {
        robots[host] = [];
      }
      await addSitemap(o + "/sitemap.xml", seeds, inSite);
    }
    try {
      for (const u of await collectCandidates(siteUrl)) if (inSite(u)) seeds.add(u);
    } catch {
      /* GSC unavailable — direct seeds still drive the crawl */
    }
    const frontier = [...seeds].filter(inSite).map((url) => ({ url, depth: 0 }));
    state = { seededAt: new Date().toISOString(), done: false, frontier, robots, origins };
    cache = {};
    seededThisRun = true;
  }

  const queued = new Set(state.frontier.map((f) => f.url));
  let crawledThisRun = 0;
  let skippedByRobots = 0;
  let errors = 0;

  while (state.frontier.length > 0 && crawledThisRun < maxPages && Object.keys(cache).length < CRAWL_CAP) {
    const batch: { url: string; depth: number }[] = [];
    while (state.frontier.length > 0 && batch.length < CONCURRENCY && crawledThisRun + batch.length < maxPages) {
      const item = state.frontier.shift()!;
      queued.delete(item.url);
      if (cache[item.url]) continue; // already crawled
      if (isDisallowed(item.url, state.robots)) {
        skippedByRobots++;
        continue;
      }
      batch.push(item);
    }
    if (batch.length === 0) continue;

    const t0 = Date.now();
    const results = await Promise.all(
      batch.map((item) => fetchFollowing(item.url).then((fr) => analyze(item.url, item.depth, fr, inSite)))
    );
    for (const rec of results) {
      cache[rec.url] = rec;
      crawledThisRun++;
      if (rec.status === 0) errors++;
      // enqueue freshly discovered internal links (and the resolved finalUrl)
      const discovered = rec.nofollow ? [] : rec.internalLinks;
      const next = rec.redirectChain.length > 0 && inSite(rec.finalUrl) ? [rec.finalUrl, ...discovered] : discovered;
      for (const link of next) {
        if (cache[link] || queued.has(link)) continue;
        if (Object.keys(cache).length + queued.size >= CRAWL_CAP) break;
        state.frontier.push({ url: link, depth: rec.depth + 1 });
        queued.add(link);
      }
    }
    const elapsed = Date.now() - t0;
    if (state.frontier.length > 0 && crawledThisRun < maxPages && elapsed < 600) await sleep(600 - elapsed);
  }

  state.done = state.frontier.length === 0;
  state.lastRunAt = new Date().toISOString();
  writeSiteJson(siteUrl, "crawl.json", cache);
  writeSiteJson(siteUrl, "crawl-state.json", state);

  // summary
  const statusCounts: Record<string, number> = {};
  let redirectsFound = 0;
  for (const r of Object.values(cache)) {
    const k = r.status === 0 ? "error" : `${Math.floor(r.status / 100)}xx`;
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
    if (r.redirectChain.length > 0) redirectsFound++;
  }

  return {
    siteUrl,
    seededThisRun,
    crawledThisRun,
    totalCrawled: Object.keys(cache).length,
    frontierRemaining: state.frontier.length,
    done: state.done,
    skippedByRobots,
    errors,
    statusCounts,
    redirectsFound,
    note: state.done
      ? `Crawl complete — ${Object.keys(cache).length} pages.`
      : `${state.frontier.length} URLs still queued — run crawl_site again to continue (up to ${CRAWL_CAP} pages total).`,
  };
}
