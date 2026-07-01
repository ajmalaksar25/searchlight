import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { crawlSite } from "../crawl.js";
import { siteAudit } from "../siteaudit.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

/**
 * Direct-fetch site crawler. Fetches the live site over HTTP (no Google scope,
 * no URL-Inspection quota) and follows internal links to build a site-wide map:
 * per-URL status, full redirect chains, response headers (X-Robots-Tag),
 * on-page signals, and the internal-link graph. Bounded + resumable. Feeds
 * site_audit and crawl-aware diagnose_site. Backed by src/crawl.ts.
 */
export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "crawl_site",
    {
      title: "Crawl the live site (direct fetch, no quota)",
      description:
        "Crawl the actual website over HTTP — independent of the Search Console URL-Inspection quota and needing " +
        "no Google scope. Seeds from the live sitemap + robots.txt + homepage (so a fresh, never-submitted site " +
        "still gets crawled) and follows internal links, capturing each URL's status, FULL redirect chain, " +
        "X-Robots-Tag, canonical/meta-robots/title, and internal links. Bounded per call and resumable — call " +
        "again to continue where it left off. Obeys robots.txt and a concurrency cap. Run this before site_audit.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        maxPages: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Pages to fetch this run. Default 150 (resumable — call again to continue)."),
        reset: z
          .boolean()
          .optional()
          .describe("Discard any prior crawl for this site and start fresh. Default false (resume)."),
      },
    },
    async ({ siteUrl, maxPages, reset }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const progress = await crawlSite(resolved, { maxPages, reset });
        return ok(progress);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "site_audit",
    {
      title: "Site-wide technical SEO audit (from the crawl)",
      description:
        "Turn the crawl (run crawl_site first) into a triaged, site-wide report: status inventory (4xx/5xx), " +
        "redirect chains/loops and 301-vs-302 guidance, noindex pages, canonical health (missing, host/protocol " +
        "split, trailing-slash), and the internal-link graph with ORPHAN detection. Findings are ranked by " +
        "severity then affected-page count ('fix these first'). Read-only and instant — reads the local crawl cache.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok(siteAudit(resolved));
      } catch (e) {
        return fail(e);
      }
    }
  );
};
