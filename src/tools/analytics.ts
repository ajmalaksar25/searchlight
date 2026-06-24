import { z } from "zod";
import { ok, fail } from "../util/result.js";
import {
  runSearchAnalytics,
  rowsToObjects,
  daysAgo,
  DIMENSIONS,
  FILTER_OPERATORS,
  type AnalyticsRow,
} from "../gsc.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "query_search_analytics",
    {
      title: "Query search analytics",
      description:
        "The core Search Console performance query. Returns clicks, impressions, CTR and average position, " +
        "broken down by the dimensions you request, over a date range. Use top_queries / top_pages for quick cases.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        startDate: z.string().optional().describe("YYYY-MM-DD. Defaults to 28 days ago."),
        endDate: z
          .string()
          .optional()
          .describe("YYYY-MM-DD. Defaults to 2 days ago (GSC data lags ~2 days)."),
        dimensions: z
          .array(z.enum(DIMENSIONS))
          .optional()
          .describe("Group results by these. Omit for site-wide totals."),
        type: z
          .enum(["web", "image", "video", "news", "discover", "googleNews"])
          .optional()
          .describe("Search type. Defaults to web."),
        dimensionFilters: z
          .array(
            z.object({
              dimension: z.enum(DIMENSIONS),
              operator: z.enum(FILTER_OPERATORS).optional(),
              expression: z.string(),
            })
          )
          .optional()
          .describe("AND-combined filters, e.g. filter page contains '/blog/'."),
        rowLimit: z.number().int().min(1).max(25000).optional().describe("Default 1000."),
        startRow: z.number().int().min(0).optional().describe("For pagination. Default 0."),
        aggregationType: z.enum(["auto", "byPage", "byProperty"]).optional(),
        dataState: z
          .enum(["final", "all"])
          .optional()
          .describe("'all' includes fresh, not-yet-finalized data."),
      },
    },
    async (args) => {
      try {
        const { siteUrl } = ctx.resolveSite(args.siteUrl);
        const dims = (args.dimensions as string[]) ?? [];
        const data = await runSearchAnalytics({ ...args, siteUrl });
        return ok({
          siteUrl,
          rowCount: data.rows?.length ?? 0,
          rows: rowsToObjects(dims, data.rows as AnalyticsRow[]),
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "top_queries",
    {
      title: "Top queries",
      description: "Quick view of the top search queries for a site over the last N days, ranked by clicks.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        days: z.number().int().min(1).max(480).optional().describe("Lookback window. Default 28."),
        limit: z.number().int().min(1).max(5000).optional().describe("Rows to return. Default 25."),
      },
    },
    async ({ siteUrl, days, limit }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const data = await runSearchAnalytics({
          siteUrl: resolved,
          startDate: daysAgo((days ?? 28) + 2),
          endDate: daysAgo(2),
          dimensions: ["query"],
          rowLimit: limit ?? 25,
        });
        return ok(rowsToObjects(["query"], data.rows as AnalyticsRow[]));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "top_pages",
    {
      title: "Top pages",
      description: "Quick view of the top landing pages for a site over the last N days, ranked by clicks.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        days: z.number().int().min(1).max(480).optional().describe("Lookback window. Default 28."),
        limit: z.number().int().min(1).max(5000).optional().describe("Rows to return. Default 25."),
      },
    },
    async ({ siteUrl, days, limit }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const data = await runSearchAnalytics({
          siteUrl: resolved,
          startDate: daysAgo((days ?? 28) + 2),
          endDate: daysAgo(2),
          dimensions: ["page"],
          rowLimit: limit ?? 25,
        });
        return ok(rowsToObjects(["page"], data.rows as AnalyticsRow[]));
      } catch (e) {
        return fail(e);
      }
    }
  );
};
