import { gscClient, runSearchAnalytics, rowsToObjects, daysAgo, type AnalyticsRow } from "./gsc.js";
import { readSiteJson, writeSiteJson, quotaUsedToday, addQuota } from "./cache.js";

/**
 * Reconstructs the "Page indexing" report the GSC API will not export in bulk.
 * Candidate URLs come from sitemaps + the analytics `page` dimension; each is
 * inspected via the URL Inspection API (2,000/day per property), cached, and
 * bucketed by coverageState. The crawl is resumable across calls and days.
 * See SPEC §7.
 */
export const URL_INSPECTION_DAILY_QUOTA = 2000;
const STALE_MS = 30 * 86400000; // re-inspect a URL after 30 days
const CANDIDATE_TTL_MS = 86400000; // refresh the candidate list after 24h
const CANDIDATE_CAP = 50000;

export interface InspectionRecord {
  url: string;
  verdict: string | null; // PASS = on Google
  coverageState: string | null; // e.g. "Crawled - currently not indexed"
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  sitemap: string[] | null;
  inspectedAt: string;
}

type CoverageCache = Record<string, InspectionRecord>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}

function domainMatches(siteUrl: string, url: string): boolean {
  try {
    if (siteUrl.startsWith("sc-domain:")) {
      const domain = siteUrl.slice("sc-domain:".length).toLowerCase();
      const host = new URL(url).hostname.toLowerCase();
      return host === domain || host.endsWith("." + domain);
    }
    return url.startsWith(siteUrl);
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "searchlight coverage crawler" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

/** Recursively expand a sitemap (handles sitemap-index files) into page URLs. */
async function fetchSitemapUrls(
  sitemapUrl: string,
  depth: number,
  acc: Set<string>
): Promise<void> {
  if (depth > 2 || acc.size >= CANDIDATE_CAP) return;
  let xml: string;
  try {
    xml = await fetchText(sitemapUrl);
  } catch {
    return;
  }
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs = extractLocs(xml);
  if (isIndex) {
    for (const child of locs) {
      if (acc.size >= CANDIDATE_CAP) break;
      await fetchSitemapUrls(child, depth + 1, acc);
    }
  } else {
    for (const u of locs) {
      if (acc.size >= CANDIDATE_CAP) break;
      acc.add(u);
    }
  }
}

/** Union of sitemap URLs and URLs seen in the last ~90 days of analytics. */
export async function collectCandidates(siteUrl: string): Promise<string[]> {
  const gsc = await gscClient();
  const set = new Set<string>();

  try {
    const sm = await gsc.sitemaps.list({ siteUrl });
    for (const s of sm.data.sitemap ?? []) {
      if (s.path) await fetchSitemapUrls(s.path, 0, set);
    }
  } catch {
    /* no sitemaps or fetch failed — analytics still contributes */
  }

  try {
    const data = await runSearchAnalytics({
      siteUrl,
      startDate: daysAgo(92),
      endDate: daysAgo(2),
      dimensions: ["page"],
      rowLimit: 25000,
    });
    for (const r of rowsToObjects(["page"], data.rows as AnalyticsRow[])) {
      if (r.page) set.add(String(r.page));
    }
  } catch {
    /* analytics failed — sitemaps still contribute */
  }

  return [...set].filter((u) => domainMatches(siteUrl, u));
}

async function inspectOne(siteUrl: string, url: string): Promise<InspectionRecord> {
  const gsc = await gscClient();
  const res = await gsc.urlInspection.index.inspect({
    requestBody: { siteUrl, inspectionUrl: url },
  });
  const r = res.data.inspectionResult?.indexStatusResult ?? {};
  return {
    url,
    verdict: r.verdict ?? null,
    coverageState: r.coverageState ?? null,
    robotsTxtState: r.robotsTxtState ?? null,
    indexingState: r.indexingState ?? null,
    pageFetchState: r.pageFetchState ?? null,
    googleCanonical: r.googleCanonical ?? null,
    userCanonical: r.userCanonical ?? null,
    lastCrawlTime: r.lastCrawlTime ?? null,
    crawledAs: r.crawledAs ?? null,
    sitemap: r.sitemap ?? null,
    inspectedAt: new Date().toISOString(),
  };
}

export function loadCoverage(siteUrl: string): CoverageCache {
  return readSiteJson<CoverageCache>(siteUrl, "coverage.json", {});
}

export interface RefreshProgress {
  siteUrl: string;
  inspectedThisRun: number;
  errors: number;
  totalCandidates: number;
  totalInspected: number;
  pendingAfter: number;
  quotaUsedToday: number;
  quotaPerDay: number;
  quotaRemaining: number;
  candidatesRefreshed: boolean;
  note: string;
}

interface SiteMeta {
  lastCandidateRefresh?: string;
  lastInspectRefresh?: string;
}

/** Advance the crawl by up to `maxUrls`, within today's quota. Resumable. */
export async function refreshCoverage(siteUrl: string, maxUrls = 100): Promise<RefreshProgress> {
  const meta = readSiteJson<SiteMeta>(siteUrl, "meta.json", {});
  let candidates = readSiteJson<string[]>(siteUrl, "candidates.json", []);
  let candidatesRefreshed = false;
  const candAge = meta.lastCandidateRefresh
    ? Date.now() - Date.parse(meta.lastCandidateRefresh)
    : Infinity;
  if (candidates.length === 0 || candAge > CANDIDATE_TTL_MS) {
    candidates = await collectCandidates(siteUrl);
    writeSiteJson(siteUrl, "candidates.json", candidates);
    meta.lastCandidateRefresh = new Date().toISOString();
    writeSiteJson(siteUrl, "meta.json", meta);
    candidatesRefreshed = true;
  }

  const cache = loadCoverage(siteUrl);
  const now = Date.now();
  const pending = candidates.filter((u) => {
    const rec = cache[u];
    return !rec || now - Date.parse(rec.inspectedAt) > STALE_MS;
  });

  const remaining = Math.max(0, URL_INSPECTION_DAILY_QUOTA - quotaUsedToday(siteUrl));
  const budget = Math.min(maxUrls, remaining, pending.length);

  let inspected = 0;
  let errors = 0;
  const batchSize = 8;
  for (let i = 0; i < budget; i += batchSize) {
    const batch = pending.slice(i, Math.min(i + batchSize, budget));
    const t0 = Date.now();
    const results = await Promise.all(
      batch.map((u) =>
        inspectOne(siteUrl, u)
          .then((rec) => ({ ok: true as const, rec }))
          .catch(() => ({ ok: false as const }))
      )
    );
    for (const res of results) {
      if (res.ok) {
        cache[res.rec.url] = res.rec;
        inspected++;
      } else {
        errors++;
      }
    }
    addQuota(siteUrl, batch.length); // count attempts against the daily quota
    const elapsed = Date.now() - t0;
    if (i + batchSize < budget && elapsed < 1000) await sleep(1000 - elapsed); // stay under 600/min
  }

  writeSiteJson(siteUrl, "coverage.json", cache);
  meta.lastInspectRefresh = new Date().toISOString();
  writeSiteJson(siteUrl, "meta.json", meta);

  const usedNow = quotaUsedToday(siteUrl);
  const pendingAfter = pending.length - inspected;
  return {
    siteUrl,
    inspectedThisRun: inspected,
    errors,
    totalCandidates: candidates.length,
    totalInspected: Object.keys(cache).length,
    pendingAfter,
    quotaUsedToday: usedNow,
    quotaPerDay: URL_INSPECTION_DAILY_QUOTA,
    quotaRemaining: Math.max(0, URL_INSPECTION_DAILY_QUOTA - usedNow),
    candidatesRefreshed,
    note:
      pendingAfter > 0
        ? `${pendingAfter} URLs still pending — run refresh_coverage again to resume (up to ${URL_INSPECTION_DAILY_QUOTA}/day per site).`
        : "Coverage is fully up to date.",
  };
}

export interface CoverageBucket {
  state: string;
  count: number;
  sampleUrls: string[];
}

/** Group cached inspections into the Page-indexing buckets GSC shows. */
export function bucketCoverage(cache: CoverageCache): {
  totals: { indexed: number; notIndexed: number; totalInspected: number };
  buckets: CoverageBucket[];
} {
  const records = Object.values(cache);
  const byState = new Map<string, InspectionRecord[]>();
  let indexed = 0;
  let notIndexed = 0;
  for (const r of records) {
    const state = r.coverageState ?? "Unknown";
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state)!.push(r);
    if (r.verdict === "PASS") indexed++;
    else notIndexed++;
  }
  const buckets = [...byState.entries()]
    .map(([state, recs]) => ({
      state,
      count: recs.length,
      sampleUrls: recs.slice(0, 10).map((x) => x.url),
    }))
    .sort((a, b) => b.count - a.count);
  return { totals: { indexed, notIndexed, totalInspected: records.length }, buckets };
}

export function pagesInBucket(
  cache: CoverageCache,
  state: string,
  limit: number,
  startRow: number
): { state: string; total: number; rows: InspectionRecord[] } {
  const all = Object.values(cache).filter((r) => (r.coverageState ?? "Unknown") === state);
  return { state, total: all.length, rows: all.slice(startRow, startRow + limit) };
}
