import type { Finding, Severity } from "./diagnose.js";
import { loadCrawl, type CrawlRecord } from "./crawl.js";
import { normKey } from "./util/web.js";

/**
 * Turns a crawl (crawl.json, produced by crawl_site) into a triaged, site-wide
 * technical-SEO report: status inventory, redirect chains/loops, indexability,
 * canonical health, and the internal-link graph with orphan detection. Findings
 * use the same shape as diagnose_site, ranked by severity then affected-page
 * count ("fix these first"). Pure-crawl signals only — cross-source (sitemap ×
 * GSC × crawl) reconciliation is diagnose_site's job, so the two don't
 * double-count. See ROADMAP §P1.3/§P1.4.
 */

export interface SiteAudit {
  siteUrl: string;
  crawledPages: number;
  score: number;
  grade: string;
  headline: string;
  metrics: {
    total: number;
    indexable: number;
    noindex: number;
    redirected: number;
    broken: number; // 4xx + 5xx
    errors: number; // fetch failures (status 0)
    orphans: number;
    statusCounts: Record<string, number>;
  };
  graph: {
    nodes: number;
    edges: number;
    orphanSample: string[];
    mostLinked: { url: string; inLinks: number }[];
  };
  findings: Finding[];
}

function pathOf(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

const SEV_WEIGHT: Record<Severity, number> = { critical: 3, warning: 2, info: 1, good: 0 };

export function siteAudit(siteUrl: string): SiteAudit {
  const cache = loadCrawl(siteUrl);
  const records = Object.values(cache);

  if (records.length === 0) {
    return {
      siteUrl,
      crawledPages: 0,
      score: 0,
      grade: "F",
      headline: "No crawl data yet — run crawl_site first, then re-run site_audit.",
      metrics: { total: 0, indexable: 0, noindex: 0, redirected: 0, broken: 0, errors: 0, orphans: 0, statusCounts: {} },
      graph: { nodes: 0, edges: 0, orphanSample: [], mostLinked: [] },
      findings: [],
    };
  }

  // --- internal-link graph (in-degree) ---
  // A link to a URL that redirects should credit its target, else the target
  // looks orphaned. Build a redirect map and resolve link keys through it.
  const redirectMap = new Map<string, string>();
  const byKey = new Map<string, CrawlRecord>();
  for (const r of records) {
    byKey.set(normKey(r.url), r);
    if (r.redirectChain.length > 0) redirectMap.set(normKey(r.url), normKey(r.finalUrl));
  }
  const inDegree = new Map<string, number>();
  let edges = 0;
  for (const r of records) {
    for (const link of r.internalLinks) {
      const raw = normKey(link, r.finalUrl);
      const k = redirectMap.get(raw) ?? raw;
      inDegree.set(k, (inDegree.get(k) ?? 0) + 1);
      edges++;
    }
  }
  const mostLinked = [...inDegree.entries()]
    .map(([url, inLinks]) => ({ url, inLinks }))
    .sort((a, b) => b.inLinks - a.inLinks)
    .slice(0, 10);

  // orphans: reachable 200 HTML pages nothing links to (excludes homepages at path "/")
  const orphans = records.filter(
    (r) => r.status === 200 && pathOf(r.url) !== "/" && (inDegree.get(normKey(r.url)) ?? 0) === 0
  );

  const findings: Finding[] = [];
  const sample = (recs: CrawlRecord[]) => recs.slice(0, 10).map((r) => r.url);
  const add = (
    severity: Severity,
    id: string,
    recs: CrawlRecord[] | string[],
    title: string,
    why: string,
    whatToDo: string,
    technical?: string
  ) => {
    const urls = recs.length && typeof recs[0] === "string" ? (recs as string[]).slice(0, 10) : sample(recs as CrawlRecord[]);
    findings.push({ id, severity, title, why, whatToDo, technical, count: recs.length, sampleUrls: urls });
  };

  // --- status inventory ---
  const s4 = records.filter((r) => r.status >= 400 && r.status < 500);
  const s5 = records.filter((r) => r.status >= 500);
  const errs = records.filter((r) => r.status === 0);
  if (s4.length) {
    add("critical", "status:4xx", s4, `${s4.length} page${s4.length > 1 ? "s" : ""} return a 4xx error`, "Linked pages that return 'not found' or similar can't be indexed and waste crawl budget — and users hit dead ends.", "Fix or remove the links to these URLs, or restore the pages so they return 200.");
  }
  if (s5.length) {
    add("critical", "status:5xx", s5, `${s5.length} page${s5.length > 1 ? "s" : ""} return a 5xx server error`, "Server errors make pages unreachable for Google and visitors — persistent 5xx can get pages dropped from the index.", "Investigate the server errors on these URLs and make them return 200.");
  }
  if (errs.length) {
    add("warning", "status:error", errs, `${errs.length} URL${errs.length > 1 ? "s" : ""} could not be fetched`, "These didn't respond at all (DNS/timeout/connection) during the crawl, so neither we nor Google could read them.", "Check these URLs load in a browser; if they're dead, remove the links pointing to them.");
  }

  // --- redirects ---
  const loops = records.filter((r) => r.redirectLoop);
  const longChains = records.filter((r) => !r.redirectLoop && r.redirectChain.length > 1);
  const tempRedirects = records.filter((r) => r.redirectChain.some((h) => h.status === 302 || h.status === 307));
  if (loops.length) {
    add("critical", "redirect:loop", loops, `${loops.length} URL${loops.length > 1 ? "s" : ""} redirect in a loop`, "A redirect loop never resolves — the page is completely unreachable for Google and users.", "Fix the redirect target so it lands on a single working URL that returns 200.");
  }
  if (longChains.length) {
    add("warning", "redirect:chain", longChains, `${longChains.length} URL${longChains.length > 1 ? "s" : ""} redirect through 2+ hops`, "Each extra hop slows the page and Google may stop following long chains, so link equity leaks.", "Collapse each chain to a single hop that goes straight to the final 200 URL.", `e.g. ${longChains[0].url} -> ${longChains[0].redirectChain.length} hops -> ${longChains[0].finalUrl}`);
  }
  if (tempRedirects.length) {
    add("info", "redirect:temporary", tempRedirects, `${tempRedirects.length} redirect${tempRedirects.length > 1 ? "s use" : " uses"} a temporary (302/307) status`, "A 302/307 tells Google the move is temporary, so it keeps the OLD URL indexed. If the move is permanent that's the wrong signal.", "If the redirect is permanent, change it to a 301 so Google transfers ranking to the new URL.");
  }

  // --- indexability ---
  const noidx = records.filter((r) => r.status === 200 && r.noindex);
  if (noidx.length) {
    add("warning", "index:noindex", noidx, `${noidx.length} crawlable page${noidx.length > 1 ? "s have" : " has"} a noindex instruction`, "These pages load fine but tell Google to keep them out of search (via meta robots or X-Robots-Tag). Fine if intentional, a silent traffic leak if not.", "Confirm each of these should be hidden; remove the noindex from any that should rank.");
  }

  // --- structured data validity ---
  const invalidSchema = records.filter((r) => r.schemaInvalid > 0);
  if (invalidSchema.length) {
    add("warning", "schema:invalid", invalidSchema, `${invalidSchema.length} page${invalidSchema.length > 1 ? "s have" : " has"} invalid structured data`, "Google silently ignores JSON-LD it can't parse, so these pages get zero rich-result benefit and you never see an error.", "Fix the JSON syntax in the structured-data scripts (validate with Google's Rich Results Test).");
  }

  // --- hreflang reciprocity (only when hreflang is used) ---
  const nonReciprocal = records.filter((r) => {
    if (r.status !== 200 || r.hreflang.length === 0) return false;
    return r.hreflang.some((e) => {
      const target = byKey.get(normKey(e.href));
      if (!target || normKey(target.url) === normKey(r.url)) return false; // off-site/self: skip
      return !target.hreflang.some((back) => normKey(back.href) === normKey(r.url));
    });
  });
  if (nonReciprocal.length) {
    add("warning", "hreflang:non-reciprocal", nonReciprocal, `${nonReciprocal.length} page${nonReciprocal.length > 1 ? "s have" : " has"} a non-reciprocal hreflang link`, "hreflang must be mutual: if page A points to B as a language alternate, B must point back to A. One-way hreflang is ignored by Google, so your international pages don't get connected.", "Add the return hreflang link on each target page (every alternate should list all the others, including itself).");
  }

  // --- canonical health ---
  const html200 = records.filter((r) => r.status === 200);
  const missingCanon = html200.filter((r) => !r.canonical);
  const hostProtoMismatch: CrawlRecord[] = [];
  const slashMismatch: CrawlRecord[] = [];
  for (const r of html200) {
    if (!r.canonical) continue;
    let canon: URL, self: URL;
    try {
      canon = new URL(r.canonical, r.finalUrl);
      self = new URL(r.url);
    } catch {
      continue;
    }
    if (normKey(canon.href) === normKey(self.href)) continue; // agrees (ignoring trailing slash/case)
    if (canon.host.toLowerCase() !== self.host.toLowerCase() || canon.protocol !== self.protocol) {
      hostProtoMismatch.push(r);
    } else if (canon.pathname.replace(/\/$/, "") === self.pathname.replace(/\/$/, "")) {
      slashMismatch.push(r); // same path, differs only by trailing slash
    }
  }
  if (missingCanon.length) {
    add("info", "canonical:missing", missingCanon, `${missingCanon.length} page${missingCanon.length > 1 ? "s have" : " has"} no canonical tag`, "Without a canonical, Google may treat URL variants (slashes, params, www) as duplicates and pick the wrong one.", "Add a self-referencing canonical to each page.");
  }
  if (hostProtoMismatch.length) {
    add("warning", "canonical:host", hostProtoMismatch, `${hostProtoMismatch.length} page${hostProtoMismatch.length > 1 ? "s point" : " points"} their canonical at a different host/protocol`, "This is the www-vs-apex / http-vs-https canonical split — if the live redirect and the canonical disagree, Google sees duplicates and may index the wrong URL.", "Make the canonical host+protocol match the one you actually redirect to.", `e.g. ${hostProtoMismatch[0].url} -> canonical ${hostProtoMismatch[0].canonical}`);
  }
  if (slashMismatch.length) {
    add("info", "canonical:slash", slashMismatch, `${slashMismatch.length} canonical${slashMismatch.length > 1 ? "s differ" : " differs"} from the live URL only by a trailing slash`, "A canonical that doesn't exactly match the URL Google crawled adds a small ambiguity Google has to resolve.", "Make the canonical string exactly match the served URL (with or without the trailing slash, consistently).");
  }

  // --- orphans ---
  if (orphans.length) {
    add("warning", "links:orphan", orphans, `${orphans.length} page${orphans.length > 1 ? "s are" : " is"} orphaned (no internal links point to them)`, "Pages nothing links to are hard for Google to discover and rank — they were only found here via the sitemap. Internal links pass authority and aid crawling.", "Add internal links to these pages from related, well-linked pages.");
  }

  // --- rank: severity, then affected-page count ---
  findings.sort((a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity] || (b.count ?? 0) - (a.count ?? 0));

  // --- metrics + score ---
  const statusCounts: Record<string, number> = {};
  for (const r of records) {
    const k = r.status === 0 ? "error" : `${Math.floor(r.status / 100)}xx`;
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }
  const metrics = {
    total: records.length,
    indexable: records.filter((r) => r.indexable).length,
    noindex: noidx.length,
    redirected: records.filter((r) => r.redirectChain.length > 0).length,
    broken: s4.length + s5.length,
    errors: errs.length,
    orphans: orphans.length,
    statusCounts,
  };

  let score = 100;
  for (const f of findings) score -= (f.severity === "critical" ? 12 : f.severity === "warning" ? 5 : 1) * Math.min(3, Math.ceil((f.count ?? 1) / 5));
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  const critical = findings.filter((f) => f.severity === "critical");
  const headline = critical.length
    ? `${critical.length} critical issue${critical.length > 1 ? "s" : ""} across ${records.length} crawled pages — fix these first.`
    : findings.length
      ? `${records.length} pages crawled, ${metrics.indexable} indexable; ${findings.length} thing${findings.length > 1 ? "s" : ""} worth improving.`
      : `${records.length} pages crawled and nothing critical found — clean technical foundation.`;

  return {
    siteUrl,
    crawledPages: records.length,
    score,
    grade,
    headline,
    metrics,
    graph: { nodes: records.length, edges, orphanSample: orphans.slice(0, 10).map((r) => r.url), mostLinked },
    findings,
  };
}
