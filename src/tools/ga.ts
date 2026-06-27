import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { listProperties, runReport, gaErrorMessage } from "../ga.js";
import type { ToolModule } from "./shared.js";

const gaFail = (e: unknown) => fail(new Error(gaErrorMessage(e)));

export const register: ToolModule = (server, ctx) => {
  void ctx;

  server.registerTool(
    "ga_list_properties",
    {
      title: "List Google Analytics 4 properties",
      description:
        "List the GA4 properties the signed-in user can access, with their website URLs — use this to find the " +
        "propertyId for the other ga_* tools and to match a property to a Search Console site.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await listProperties());
      } catch (e) {
        return gaFail(e);
      }
    }
  );

  server.registerTool(
    "ga_traffic",
    {
      title: "GA4 traffic by channel",
      description:
        "Where your visitors come from (Organic Search, Direct, Referral, Paid, Social…) over the last N days: " +
        "sessions, users, views and engagement rate per channel. Answers 'is anyone coming, and from where'.",
      inputSchema: {
        propertyId: z.string().describe("GA4 property ID (digits only). Get it from ga_list_properties."),
        days: z.number().int().min(1).max(365).optional().describe("Lookback window. Default 28."),
      },
    },
    async ({ propertyId, days }) => {
      try {
        const r = await runReport(propertyId, {
          days,
          dimensions: ["sessionDefaultChannelGroup"],
          metrics: ["sessions", "totalUsers", "screenPageViews", "engagementRate"],
          orderByMetricDesc: "sessions",
          limit: 20,
        });
        return ok(r);
      } catch (e) {
        return gaFail(e);
      }
    }
  );

  server.registerTool(
    "ga_top_pages",
    {
      title: "GA4 top pages",
      description: "Most-visited pages over the last N days (path, views, sessions, engagement).",
      inputSchema: {
        propertyId: z.string().describe("GA4 property ID (digits only)."),
        days: z.number().int().min(1).max(365).optional().describe("Lookback window. Default 28."),
        limit: z.number().int().min(1).max(500).optional().describe("Rows. Default 25."),
      },
    },
    async ({ propertyId, days, limit }) => {
      try {
        const r = await runReport(propertyId, {
          days,
          dimensions: ["pagePath"],
          metrics: ["screenPageViews", "sessions", "engagementRate"],
          orderByMetricDesc: "screenPageViews",
          limit: limit ?? 25,
        });
        return ok(r);
      } catch (e) {
        return gaFail(e);
      }
    }
  );

  server.registerTool(
    "ga_report",
    {
      title: "GA4 custom report",
      description:
        "Run an arbitrary GA4 report. Pick any GA4 dimensions and metrics (e.g. dimensions ['date'], metrics " +
        "['sessions','totalUsers']). For advanced/custom analysis.",
      inputSchema: {
        propertyId: z.string().describe("GA4 property ID (digits only)."),
        metrics: z.array(z.string()).describe("GA4 metric names, e.g. ['sessions','totalUsers','engagementRate']."),
        dimensions: z.array(z.string()).optional().describe("GA4 dimension names, e.g. ['date','pagePath']."),
        days: z.number().int().min(1).max(365).optional().describe("Lookback window. Default 28."),
        limit: z.number().int().min(1).max(1000).optional().describe("Rows. Default 100."),
      },
    },
    async ({ propertyId, metrics, dimensions, days, limit }) => {
      try {
        return ok(await runReport(propertyId, { days, dimensions, metrics, limit }));
      } catch (e) {
        return gaFail(e);
      }
    }
  );
};
