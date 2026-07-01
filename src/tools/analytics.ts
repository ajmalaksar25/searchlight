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
        "broken down by the dimensions you request, over a date range. For quick cases pass preset " +
        "'top_queries' or 'top_pages' with days — no need to set dimensions/dates yourself.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        preset: z
          .enum(["top_queries", "top_pages"])
          .optional()
          .describe("Shortcut: 'top_queries' groups by query, 'top_pages' by page (both ranked by clicks). Sets dimensions for you."),
        days: z
          .number()
          .int()
          .min(1)
          .max(480)
          .optional()
          .describe("Convenience lookback: sets the date range to the last N days. Ignored if startDate is given."),
        startDate: z.string().optional().describe("YYYY-MM-DD. Defaults to 28 days ago."),
        endDate: z
          .string()
          .optional()
          .describe("YYYY-MM-DD. Defaults to 2 days ago (GSC data lags ~2 days)."),
        dimensions: z
          .array(z.enum(DIMENSIONS))
          .optional()
          .describe("Group results by these. Omit for site-wide totals (or use preset)."),
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
        let dims = (args.dimensions as string[]) ?? [];
        if (dims.length === 0 && args.preset) dims = args.preset === "top_pages" ? ["page"] : ["query"];
        const startDate = args.startDate ?? (args.days ? daysAgo(args.days + 2) : undefined);
        const endDate = args.endDate ?? (args.days ? daysAgo(2) : undefined);
        const data = await runSearchAnalytics({
          siteUrl,
          startDate,
          endDate,
          dimensions: dims.length ? (dims as (typeof DIMENSIONS)[number][]) : undefined,
          type: args.type,
          dimensionFilters: args.dimensionFilters,
          rowLimit: args.rowLimit,
          startRow: args.startRow,
          aggregationType: args.aggregationType,
          dataState: args.dataState,
        });
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
};
