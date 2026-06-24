import { z } from "zod";
import { ok, fail, round } from "../util/result.js";
import { runSearchAnalytics, rowsToObjects, daysAgo, type AnalyticsRow } from "../gsc.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "find_opportunities",
    {
      title: "Find SEO opportunities",
      description:
        "Surface actionable wins: 'striking distance' rows ranked between positions 5-20 (small gains can push " +
        "them to page one) and high-impression / low-CTR rows (the listing shows but few click). Returns a ranked, " +
        "deduped list with a reason for each.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        dimension: z.enum(["query", "page"]).optional().describe("Analyze by query or page. Default query."),
        days: z.number().int().min(7).max(480).optional().describe("Lookback window. Default 90."),
        minImpressions: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Ignore rows below this impression count. Default 50."),
        limit: z.number().int().min(1).max(200).optional().describe("Opportunities to return. Default 25."),
      },
    },
    async ({ siteUrl, dimension, days, minImpressions, limit }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const dim = dimension ?? "query";
        const minImp = minImpressions ?? 50;
        const data = await runSearchAnalytics({
          siteUrl: resolved,
          startDate: daysAgo((days ?? 90) + 2),
          endDate: daysAgo(2),
          dimensions: [dim],
          rowLimit: 25000,
        });
        const rows = rowsToObjects([dim], data.rows as AnalyticsRow[]).filter(
          (r) => (r.impressions as number) >= minImp
        );
        const scored = rows.map((r) => {
          const pos = r.position as number;
          const ctr = r.ctr as number;
          const imp = r.impressions as number;
          const reasons: string[] = [];
          let score = 0;
          if (pos >= 5 && pos <= 20) {
            reasons.push(`striking distance (avg position ${pos})`);
            score += imp * (21 - pos);
          }
          if (pos <= 10 && ctr < 0.02 && imp >= minImp * 2) {
            reasons.push(`low CTR ${(ctr * 100).toFixed(1)}% despite ranking on page one`);
            score += imp * 5;
          }
          return { ...r, opportunityScore: round(score), reasons };
        });
        const ranked = scored
          .filter((r) => r.reasons.length > 0)
          .sort((a, b) => b.opportunityScore - a.opportunityScore)
          .slice(0, limit ?? 25);
        return ok({
          siteUrl: resolved,
          analyzed: rows.length,
          opportunities: ranked,
          note:
            "Striking-distance rows (pos 5-20) often need stronger on-page relevance or internal links. " +
            "Low-CTR page-one rows usually need a better title/meta description.",
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "compare_periods",
    {
      title: "Compare periods",
      description:
        "Compare the most recent N days against the preceding N days. Returns total clicks/impressions deltas " +
        "plus the biggest gainers and losers for the chosen dimension.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        dimension: z.enum(["query", "page"]).optional().describe("Default query."),
        days: z.number().int().min(1).max(240).optional().describe("Length of each window. Default 28."),
        limit: z.number().int().min(1).max(100).optional().describe("Movers per direction. Default 10."),
      },
    },
    async ({ siteUrl, dimension, days, limit }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const dim = dimension ?? "query";
        const n = days ?? 28;
        const top = limit ?? 10;
        const curEnd = daysAgo(2);
        const curStart = daysAgo(2 + n - 1);
        const prevEnd = daysAgo(2 + n);
        const prevStart = daysAgo(2 + n + n - 1);

        const [cur, prev] = await Promise.all([
          runSearchAnalytics({ siteUrl: resolved, startDate: curStart, endDate: curEnd, dimensions: [dim], rowLimit: 25000 }),
          runSearchAnalytics({ siteUrl: resolved, startDate: prevStart, endDate: prevEnd, dimensions: [dim], rowLimit: 25000 }),
        ]);

        const curRows = rowsToObjects([dim], cur.rows as AnalyticsRow[]);
        const prevRows = rowsToObjects([dim], prev.rows as AnalyticsRow[]);
        const prevMap = new Map(prevRows.map((r) => [r[dim] as string, r]));
        const curMap = new Map(curRows.map((r) => [r[dim] as string, r]));
        const keys = new Set<string>([...prevMap.keys(), ...curMap.keys()]);

        const movers = [...keys].map((k) => {
          const c = curMap.get(k);
          const p = prevMap.get(k);
          const cClicks = (c?.clicks as number) ?? 0;
          const pClicks = (p?.clicks as number) ?? 0;
          return {
            [dim]: k,
            clicks: cClicks,
            clicksPrev: pClicks,
            clicksDelta: cClicks - pClicks,
            position: (c?.position as number) ?? null,
            positionPrev: (p?.position as number) ?? null,
          };
        });

        const sum = (rows: Record<string, unknown>[], field: string) =>
          rows.reduce((acc, r) => acc + ((r[field] as number) ?? 0), 0);

        const totals = {
          clicks: { current: sum(curRows, "clicks"), previous: sum(prevRows, "clicks") },
          impressions: { current: sum(curRows, "impressions"), previous: sum(prevRows, "impressions") },
        };

        return ok({
          siteUrl: resolved,
          windows: { current: [curStart, curEnd], previous: [prevStart, prevEnd] },
          totals,
          gainers: movers.filter((m) => m.clicksDelta > 0).sort((a, b) => b.clicksDelta - a.clicksDelta).slice(0, top),
          losers: movers.filter((m) => m.clicksDelta < 0).sort((a, b) => a.clicksDelta - b.clicksDelta).slice(0, top),
        });
      } catch (e) {
        return fail(e);
      }
    }
  );
};
