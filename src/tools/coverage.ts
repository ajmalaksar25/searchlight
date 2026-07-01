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
        "'Blocked by robots.txt') with sample URLs. Read-only and instant. Run refresh_coverage first to populate it. " +
        "Pass `state` to drill into one bucket and list its actual URLs (paginated).",
      inputSchema: {
        siteUrl: siteUrlOptional,
        state: z
          .string()
          .optional()
          .describe("Drill into one bucket: the exact coverageState (as shown in the buckets), e.g. 'Crawled - currently not indexed'."),
        limit: z.number().int().min(1).max(500).optional().describe("For state drill-down: rows to return. Default 50."),
        startRow: z.number().int().min(0).optional().describe("For state drill-down pagination. Default 0."),
      },
    },
    async ({ siteUrl, state, limit, startRow }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const cache = loadCoverage(resolved);
        if (state) return ok(pagesInBucket(cache, state, limit ?? 50, startRow ?? 0));
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
        "to continue where it left off. May take ~10-30s. Pass allSites:true to advance EVERY accessible property " +
        "in one call (whole-portfolio refresh).",
      inputSchema: {
        siteUrl: siteUrlOptional,
        maxUrls: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Max URLs to inspect this run (per site). Default 100 (bounded by remaining quota)."),
        allSites: z
          .boolean()
          .optional()
          .describe("Refresh every accessible property instead of one (ignores siteUrl). Default false."),
      },
    },
    async ({ siteUrl, maxUrls, allSites }) => {
      try {
        if (allSites) {
          const gsc = await ctx.gsc();
          const res = await gsc.sites.list();
          const sites = (res.data.siteEntry ?? []).map((s) => s.siteUrl).filter((u): u is string => Boolean(u));
          const results = [];
          for (const site of sites) {
            try {
              results.push(await refreshCoverage(site, maxUrls ?? 100));
            } catch (e) {
              results.push({ siteUrl: site, error: e instanceof Error ? e.message : String(e) });
            }
          }
          return ok({ sitesCrawled: results.length, results });
        }
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok(await refreshCoverage(resolved, maxUrls ?? 100));
      } catch (e) {
        return fail(e);
      }
    }
  );
};
