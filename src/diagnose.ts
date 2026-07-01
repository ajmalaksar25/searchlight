import { gscClient, runSearchAnalytics, daysAgo, rowsToObjects, type AnalyticsRow } from "./gsc.js";
import { loadCoverage, bucketCoverage } from "./coverage.js";
import { loadCrawl, parseRobots } from "./crawl.js";
import { extractLocs, normKey, robotsBlocks } from "./util/web.js";
import { pagespeedApiKey } from "./keys.js";

/**
 * Turns raw GSC/coverage/live signals into a beginner-friendly health report:
 * each finding says what it is, WHY it matters, what to do, and how worried to
 * be. The output is structured so a UI can render it directly. See SPEC §8.
 */
export type Severity = "critical" | "warning" | "info" | "good";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  why: string; // plain English, no jargon
  whatToDo: string;
  technical?: string; // for the pros
  count?: number;
  sampleUrls?: string[];
}

export interface Diagnosis {
  siteUrl: string;
  healthScore: number; // 0-100, indicative
  grade: string;
  headline: string;
  metrics: {
    indexed: number;
    notIndexed: number;
    inspected: number;
    knownUrls: number;
    clicks28d: number;
    impressions28d: number;
    topQueries: string[];
  };
  triage: {
    fixNow: Finding[]; // critical
    worthImproving: Finding[]; // warning
    looksScaryButFine: Finding[]; // info / reassurance
    working: Finding[]; // good
  };
}

// How each coverageState reads to a human + how worried to be.
const STATE_MAP: Record<string, { severity: Severity; why: string; whatToDo: string }> = {
  "Submitted and indexed": {
    severity: "good",
    why: "This page is on Google and was found via your sitemap. This is the goal.",
    whatToDo: "Nothing — it's working.",
  },
  "Indexed, not submitted in sitemap": {
    severity: "good",
    why: "On Google, but Google found it on its own rather than from your sitemap.",
    whatToDo: "Add it to your sitemap so Google tracks it reliably.",
  },
  "URL is unknown to Google": {
    severity: "warning",
    why: "Google has never even seen this page — it hasn't been discovered, so it can't rank.",
    whatToDo: "Make sure it's in a sitemap Google can actually read, and link to it from other pages.",
  },
  "Crawled - currently not indexed": {
    severity: "warning",
    why: "Google looked at the page but decided not to index it — usually the content is thin, too similar to another page, or low value.",
    whatToDo: "Make the page more substantial and unique, add internal links to it, then request indexing.",
  },
  "Discovered - currently not indexed": {
    severity: "warning",
    why: "Google knows the page exists but hasn't bothered to crawl it yet — often a quality or crawl-budget signal.",
    whatToDo: "Strengthen internal links and content quality; request indexing for the important ones.",
  },
  "Page with redirect": {
    severity: "info",
    why: "This URL just forwards to another one (e.g. the non-www version forwarding to www). This is normal and usually fine.",
    whatToDo: "Nothing to worry about, as long as the page it forwards to is indexed.",
  },
  "Redirect error": {
    severity: "critical",
    why: "The forwarding is BROKEN — it loops or points somewhere invalid, so Google (and visitors) can't load the page at all.",
    whatToDo: "Fix the redirect so the URL lands on a single working page (one hop, returns 200).",
  },
  "Duplicate without user-selected canonical": {
    severity: "warning",
    why: "Google found near-identical versions of this page and had to guess which is the 'real' one.",
    whatToDo: "Add a self-referencing canonical tag so you tell Google which URL is the real one.",
  },
  "Not found (404)": {
    severity: "critical",
    why: "A URL you told Google about doesn't exist — it returns 'page not found'.",
    whatToDo: "Either restore the page or remove the dead URL from your sitemap.",
  },
  "Soft 404": {
    severity: "warning",
    why: "The page loads but looks empty/error-like to Google, so it's treated as missing.",
    whatToDo: "Add real content, or return a proper 404 if it should be gone.",
  },
  "Blocked by robots.txt": {
    severity: "critical",
    why: "Your own robots.txt file is telling Google not to look at this page.",
    whatToDo: "Remove the blocking rule in robots.txt if this page should be public.",
  },
  "Excluded by 'noindex' tag": {
    severity: "warning",
    why: "The page has a 'noindex' instruction telling Google to keep it out of search.",
    whatToDo: "Remove the noindex tag if you want this page to rank.",
  },
  "Server error (5xx)": {
    severity: "critical",
    why: "The page returned a server error when Google tried to crawl it, so it couldn't be read or indexed. Persistent 5xx gets pages dropped.",
    whatToDo: "Fix the server error so the URL returns 200, then request indexing.",
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Probe {
  status: number;
  location?: string;
  locCount?: number;
  body?: string; // kept for 200s so callers can parse robots rules / sitemap locs
}

async function probe(url: string): Promise<Probe> {
  try {
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": "searchlight" } });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, location: res.headers.get("location") ?? undefined };
    }
    if (res.status === 200) {
      const body = await res.text();
      return { status: 200, locCount: (body.match(/<loc>/gi) ?? []).length, body };
    }
    return { status: res.status };
  } catch {
    return { status: 0 };
  }
}

function candidateHosts(siteUrl: string): string[] {
  if (siteUrl.startsWith("sc-domain:")) {
    const d = siteUrl.slice("sc-domain:".length);
    return [d, "www." + d];
  }
  try {
    return [new URL(siteUrl).host];
  } catch {
    return [];
  }
}

export async function diagnoseSite(siteUrl: string): Promise<Diagnosis> {
  const findings: Finding[] = [];

  // --- coverage findings (from cache) ---
  const cov = loadCoverage(siteUrl);
  const { totals, buckets } = bucketCoverage(cov);
  for (const b of buckets) {
    const map = STATE_MAP[b.state] ?? {
      severity: "info" as Severity,
      why: "Google reports this status for these URLs.",
      whatToDo: "Inspect a sample URL for details.",
    };
    findings.push({
      id: `coverage:${b.state}`,
      severity: map.severity,
      title: `${b.count} ${b.count === 1 ? "page" : "pages"}: ${b.state}`,
      why: map.why,
      whatToDo: map.whatToDo,
      count: b.count,
      sampleUrls: b.sampleUrls,
    });
  }
  if (totals.totalInspected === 0) {
    findings.push({
      id: "coverage:empty",
      severity: "info",
      title: "Coverage not gathered yet",
      why: "We haven't inspected your pages yet, so we can't tell which are indexed.",
      whatToDo: "Run refresh_coverage (or 'refresh coverage for this site').",
    });
  }

  // --- live checks: sitemap + robots reachability ---
  const hosts = candidateHosts(siteUrl);
  let sitemapOk = false;
  let sitemapRedirects = false;
  const sitemapLocs: string[] = [];
  const robotsRules: Record<string, { disallow: string[]; allow: string[] }> = {};
  for (const host of hosts) {
    const sm = await probe(`https://${host}/sitemap.xml`);
    if (sm.status === 200 && (sm.locCount ?? 0) > 0) sitemapOk = true;
    else if (sm.status >= 300 && sm.status < 400) sitemapRedirects = true;
    if (sm.status === 200 && sm.body) sitemapLocs.push(...extractLocs(sm.body));
    const rb = await probe(`https://${host}/robots.txt`);
    if (rb.status === 200 && rb.body) {
      const pr = parseRobots(rb.body);
      robotsRules[host] = { disallow: pr.disallow, allow: pr.allow };
    }
    if ([400, 401, 403].includes(rb.status) || rb.status >= 500) {
      findings.push({
        id: `robots:${host}`,
        severity: "critical",
        title: `robots.txt on ${host} returns HTTP ${rb.status}`,
        why: `Google reads robots.txt before crawling. A ${rb.status} here is a broken response, and Google may treat ${host} as un-crawlable — this is the kind of 'critical crawl error' Search Console warns about.`,
        whatToDo: `Make https://${host}/robots.txt return 200 (an empty 'User-agent: *' / 'Allow: /' is fine), or remove the subdomain if unused.`,
        technical: `Status ${rb.status} on robots.txt for ${host}.`,
      });
    }
    await sleep(50);
  }
  if (!sitemapOk) {
    findings.push({
      id: "sitemap:unreadable",
      severity: sitemapRedirects ? "warning" : "critical",
      title: sitemapRedirects ? "Your sitemap redirects instead of loading" : "No readable sitemap found",
      why: sitemapRedirects
        ? "Your /sitemap.xml forwards somewhere instead of returning the list directly. Google often won't follow that, so your pages stay undiscovered."
        : "We couldn't find a sitemap Google can read. Without it, Google may never find most of your pages.",
      whatToDo: sitemapRedirects
        ? "Make /sitemap.xml return the list directly (HTTP 200), or submit the exact URL it redirects to in Search Console."
        : "Create a sitemap, make sure /sitemap.xml returns 200, and submit it in Search Console.",
    });
  }

  // --- submitted-sitemap check (GSC) ---
  try {
    const gsc = await gscClient();
    const sm = await gsc.sitemaps.list({ siteUrl });
    if ((sm.data.sitemap ?? []).length === 0) {
      findings.push({
        id: "sitemap:not-submitted",
        severity: "warning",
        title: "No sitemap submitted to Search Console",
        why: "Even if a sitemap exists on your site, Google tracks it best when you submit it here.",
        whatToDo: "Submit your sitemap URL in Search Console → Sitemaps.",
      });
    }
  } catch {
    /* ignore */
  }

  // --- cross-source reconciliation (only when a crawl exists) ---
  // site_audit owns pure-crawl findings; here we ONLY reconcile crawl × sitemap ×
  // robots × GSC — mismatches no single source can see. Degrades to a no-op when
  // crawl_site hasn't run, so diagnose_site is unchanged without a crawl.
  const crawl = loadCrawl(siteUrl);
  const crawlRecs = Object.values(crawl);
  if (crawlRecs.length > 0) {
    const byKey = new Map(crawlRecs.map((r) => [normKey(r.url), r]));
    const uniqSitemap = [...new Set(sitemapLocs)];
    const blockedByRobots = (url: string): boolean => {
      let host: string, path: string;
      try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname + u.search;
      } catch {
        return false;
      }
      const rules = robotsRules[host];
      return !!rules && robotsBlocks(path, rules.disallow, rules.allow);
    };

    const noidxInSitemap = uniqSitemap.filter((u) => byKey.get(normKey(u))?.noindex);
    if (noidxInSitemap.length) {
      findings.push({
        id: "reconcile:sitemap-noindex",
        severity: "warning",
        title: `${noidxInSitemap.length} sitemap URL${noidxInSitemap.length > 1 ? "s are" : " is"} set to noindex`,
        why: "You're telling Google to index these (via the sitemap) and to NOT index them (via noindex) at the same time — a contradictory signal that wastes crawl budget.",
        whatToDo: "Either remove the noindex (if they should rank) or drop them from the sitemap (if they shouldn't).",
        count: noidxInSitemap.length,
        sampleUrls: noidxInSitemap.slice(0, 10),
      });
    }

    const blocked = uniqSitemap.filter(blockedByRobots);
    if (blocked.length) {
      findings.push({
        id: "reconcile:sitemap-robots",
        severity: "critical",
        title: `${blocked.length} sitemap URL${blocked.length > 1 ? "s are" : " is"} blocked by robots.txt`,
        why: "Your sitemap asks Google to index these, but robots.txt forbids crawling them — so Google can't read them and won't index them.",
        whatToDo: "Remove the robots.txt Disallow for these paths, or drop them from the sitemap.",
        count: blocked.length,
        sampleUrls: blocked.slice(0, 10),
      });
    }

    const canonBad = crawlRecs.filter((r) => {
      if (!r.canonical) return false;
      let target;
      try {
        target = byKey.get(normKey(new URL(r.canonical, r.finalUrl).href));
      } catch {
        return false;
      }
      return !!target && normKey(target.url) !== normKey(r.url) && (target.noindex || target.status >= 400);
    });
    if (canonBad.length) {
      findings.push({
        id: "reconcile:canonical-nonindexable",
        severity: "warning",
        title: `${canonBad.length} page${canonBad.length > 1 ? "s" : ""} canonicalize to a non-indexable URL`,
        why: "These pages point their canonical at a URL that is itself noindexed or broken — so Google is told the 'real' version is one it can't index, and may drop both.",
        whatToDo: "Point the canonical at a live, indexable URL (usually the page itself).",
        count: canonBad.length,
        sampleUrls: canonBad.slice(0, 10).map((r) => r.url),
      });
    }

    const indexedBroken = Object.values(cov).filter((c) => {
      if (c.verdict !== "PASS") return false;
      const r = byKey.get(normKey(c.url));
      return !!r && (r.status >= 400 || r.noindex);
    });
    if (indexedBroken.length) {
      findings.push({
        id: "reconcile:indexed-broken",
        severity: "critical",
        title: `${indexedBroken.length} page${indexedBroken.length > 1 ? "s" : ""} Google has indexed ${indexedBroken.length > 1 ? "are" : "is"} now broken or noindexed`,
        why: "Google still lists these, but the live page now returns an error or says noindex — they'll fall out of search and users may hit dead pages.",
        whatToDo: "Restore the pages (or remove the noindex); if intentionally gone, 301 them to a relevant live page.",
        count: indexedBroken.length,
        sampleUrls: indexedBroken.slice(0, 10).map((c) => c.url),
      });
    }
  }

  // --- traffic ---
  let clicks = 0;
  let impressions = 0;
  let topQueries: string[] = [];
  try {
    const tot = await runSearchAnalytics({ siteUrl, startDate: daysAgo(30), endDate: daysAgo(2), rowLimit: 1 });
    const t = tot.rows?.[0];
    clicks = t?.clicks ?? 0;
    impressions = t?.impressions ?? 0;
    const q = await runSearchAnalytics({
      siteUrl,
      startDate: daysAgo(30),
      endDate: daysAgo(2),
      dimensions: ["query"],
      rowLimit: 5,
    });
    topQueries = rowsToObjects(["query"], q.rows as AnalyticsRow[]).map((r) => String(r.query));
  } catch {
    /* ignore */
  }
  if (impressions < 10) {
    findings.push({
      id: "traffic:low",
      severity: "info",
      title: `Almost no one is finding you in search yet (${clicks} clicks / ${impressions} impressions in 28 days)`,
      why: "This is expected while your pages aren't indexed — if Google can't list your pages, no one can find them.",
      whatToDo: "Fix the indexing issues above first; traffic follows once pages get indexed.",
    });
  }

  // --- page speed setup ---
  if (!pagespeedApiKey()) {
    findings.push({
      id: "setup:pagespeed",
      severity: "info",
      title: "Page-speed checks not enabled",
      why: "Speed affects ranking and user experience, but no PageSpeed key is configured.",
      whatToDo: "Set a PageSpeed Insights API key to enable speed/Core Web Vitals checks.",
    });
  }

  // --- score + triage ---
  const indexRate = totals.totalInspected > 0 ? totals.indexed / totals.totalInspected : 0;
  let score = totals.totalInspected > 0 ? Math.round(indexRate * 100) : 50;
  for (const f of findings) {
    if (f.severity === "critical") score -= 12;
    else if (f.severity === "warning") score -= 4;
  }
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  const critical = findings.filter((f) => f.severity === "critical");
  const headline =
    critical.length > 0
      ? `${critical.length} critical issue${critical.length > 1 ? "s" : ""} are blocking your pages from Google — fix these first.`
      : totals.indexed === 0 && totals.totalInspected > 0
        ? "None of your inspected pages are indexed yet — let's get them discovered."
        : `${totals.indexed} of ${totals.totalInspected} inspected pages are indexed.`;

  return {
    siteUrl,
    healthScore: score,
    grade,
    headline,
    metrics: {
      indexed: totals.indexed,
      notIndexed: totals.notIndexed,
      inspected: totals.totalInspected,
      knownUrls: Object.keys(cov).length,
      clicks28d: clicks,
      impressions28d: impressions,
      topQueries,
    },
    triage: {
      fixNow: findings.filter((f) => f.severity === "critical"),
      worthImproving: findings.filter((f) => f.severity === "warning"),
      looksScaryButFine: findings.filter((f) => f.severity === "info"),
      working: findings.filter((f) => f.severity === "good"),
    },
  };
}
