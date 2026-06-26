import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { readSiteJson, quotaUsedToday } from "../cache.js";
import {
  refreshCoverage,
  loadCoverage,
  bucketCoverage,
  pagesInBucket,
  URL_INSPECTION_DAILY_QUOTA,
} from "../coverage.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "coverage_report",
    {
      title: "Coverage report (Page indexing)",
      description:
        "The reconstructed 'Page indexing' report from the local cache: how many URLs are indexed vs not, " +
        "broken down into buckets (e.g. 'Crawled - currently not indexed', 'Discovered', 'Page with redirect', " +
        "'Blocked by robots.txt') with sample URLs. Read-only and instant. Run refresh_coverage first to populate it.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const cache = loadCoverage(resolved);
        const candidates = readSiteJson<string[]>(resolved, "candidates.json", []);
        const meta = readSiteJson<Record<string, string>>(resolved, "meta.json", {});
        const { totals, buckets } = bucketCoverage(cache);
        const pending = Math.max(0, candidates.length - totals.totalInspected);
        if (totals.totalInspected === 0) {
          return ok({
            siteUrl: resolved,
            status: "empty",
            hint: "No coverage cached yet. Run refresh_coverage (it inspects URLs within the 2,000/day quota).",
          });
        }
        return ok({
          siteUrl: resolved,
          totals,
          buckets,
          coverage: {
            knownUrls: candidates.length,
            inspected: totals.totalInspected,
            pending,
          },
          cache: {
            candidatesRefreshedAt: meta.lastCandidateRefresh ?? null,
            lastInspectRefresh: meta.lastInspectRefresh ?? null,
            quotaUsedToday: quotaUsedToday(resolved),
            quotaPerDay: URL_INSPECTION_DAILY_QUOTA,
          },
          note:
            pending > 0
              ? `${pending} known URLs not yet inspected — run refresh_coverage to fill them in.`
              : "All known URLs inspected.",
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "refresh_coverage",
    {
      title: "Refresh coverage (crawl within quota)",
      description:
        "Advance the coverage crawl: collect candidate URLs (sitemaps + analytics) and inspect the ones not yet " +
        "cached, up to maxUrls and within the 2,000/day per-property URL Inspection quota. Resumable — call again " +
        "to continue where it left off. May take ~10-30s.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        maxUrls: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Max URLs to inspect this run. Default 100 (bounded by remaining quota)."),
      },
    },
    async ({ siteUrl, maxUrls }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const progress = await refreshCoverage(resolved, maxUrls ?? 100);
        return ok(progress);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "get_pages_in_bucket",
    {
      title: "Get pages in a coverage bucket",
      description:
        "Drill into one coverage bucket — list the actual URLs (with index status, canonical, last crawl) for a " +
        "given coverageState, e.g. 'Crawled - currently not indexed'. Paginated.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        state: z.string().describe("The exact coverageState bucket, as shown in coverage_report."),
        limit: z.number().int().min(1).max(500).optional().describe("Rows to return. Default 50."),
        startRow: z.number().int().min(0).optional().describe("For pagination. Default 0."),
      },
    },
    async ({ siteUrl, state, limit, startRow }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const cache = loadCoverage(resolved);
        return ok(pagesInBucket(cache, state, limit ?? 50, startRow ?? 0));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "refresh_all_coverage",
    {
      title: "Refresh coverage for all sites",
      description:
        "Advance the coverage crawl for EVERY accessible property in one call — keep your whole portfolio's " +
        "Page-indexing data fresh without naming each site. Runs sites sequentially, quota-aware per property. " +
        "Resumable: call again to keep filling in pending URLs.",
      inputSchema: {
        maxUrlsPerSite: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Max URLs to inspect per site this run. Default 100."),
      },
    },
    async ({ maxUrlsPerSite }) => {
      try {
        const gsc = await ctx.gsc();
        const res = await gsc.sites.list();
        const sites = (res.data.siteEntry ?? [])
          .map((s) => s.siteUrl)
          .filter((u): u is string => Boolean(u));
        const results = [];
        for (const siteUrl of sites) {
          try {
            results.push(await refreshCoverage(siteUrl, maxUrlsPerSite ?? 100));
          } catch (e) {
            results.push({ siteUrl, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return ok({ sitesCrawled: results.length, results });
      } catch (e) {
        return fail(e);
      }
    }
  );
};
