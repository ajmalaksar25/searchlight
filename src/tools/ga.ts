import { z } from "zod";
import { ok, fail } from "../util/result.js";
import {
  listProperties,
  runReport,
  gaErrorMessage,
  listMeasurementIds,
  resolvePropertyForSite,
} from "../ga.js";
import { gtagSnippet } from "../provision.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

const gaFail = (e: unknown) => fail(new Error(gaErrorMessage(e)));

export const register: ToolModule = (server, ctx) => {
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
    "ga_report",
    {
      title: "GA4 report (traffic / top pages / custom)",
      description:
        "GA4 reporting. For quick cases pass preset 'traffic' (sessions/users/views/engagement by channel — " +
        "'is anyone coming, and from where') or 'top_pages' (most-visited pages). For custom analysis pass your " +
        "own metrics (and optional dimensions), e.g. metrics ['sessions','totalUsers'], dimensions ['date'].",
      inputSchema: {
        propertyId: z.string().describe("GA4 property ID (digits only). Get it from ga_list_properties."),
        preset: z
          .enum(["traffic", "top_pages"])
          .optional()
          .describe("Shortcut that fills metrics+dimensions: 'traffic' = by channel, 'top_pages' = by page."),
        metrics: z.array(z.string()).optional().describe("GA4 metric names. Required unless a preset is set."),
        dimensions: z.array(z.string()).optional().describe("GA4 dimension names, e.g. ['date','pagePath']."),
        orderByMetricDesc: z.string().optional().describe("Sort by this metric, descending."),
        days: z.number().int().min(1).max(365).optional().describe("Lookback window. Default 28."),
        limit: z.number().int().min(1).max(1000).optional().describe("Rows. Default 100."),
      },
    },
    async ({ propertyId, preset, metrics, dimensions, orderByMetricDesc, days, limit }) => {
      try {
        if (preset === "traffic") {
          dimensions ??= ["sessionDefaultChannelGroup"];
          metrics ??= ["sessions", "totalUsers", "screenPageViews", "engagementRate"];
          orderByMetricDesc ??= "sessions";
          limit ??= 20;
        } else if (preset === "top_pages") {
          dimensions ??= ["pagePath"];
          metrics ??= ["screenPageViews", "sessions", "engagementRate"];
          orderByMetricDesc ??= "screenPageViews";
          limit ??= 25;
        }
        if (!metrics?.length) return fail(new Error("Provide `metrics` (or a `preset`)."));
        return ok(await runReport(propertyId, { days, dimensions, metrics, limit, orderByMetricDesc }));
      } catch (e) {
        return gaFail(e);
      }
    }
  );

  server.registerTool(
    "ga_measurement_id",
    {
      title: "Get GA4 Measurement ID (G-XXXX) for a site",
      description:
        "Fetch the gtag Measurement ID(s) of an EXISTING GA4 property so the tag can be installed without anyone " +
        "pasting it by hand. Give a propertyId, or omit it to auto-match the active/default Search Console site to " +
        "its GA4 property by website URL. Returns each web stream's Measurement ID plus a ready-to-paste gtag " +
        "snippet. Read-only.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        propertyId: z
          .string()
          .optional()
          .describe("GA4 property ID (digits only). If omitted, resolved from the site's GA4 property."),
      },
    },
    async ({ siteUrl, propertyId }) => {
      try {
        let resolvedPropertyId = propertyId;
        let displayName: string | undefined;
        if (!resolvedPropertyId) {
          const { siteUrl: site } = ctx.resolveSite(siteUrl);
          const prop = await resolvePropertyForSite(site);
          if (!prop) {
            return ok({
              site,
              found: false,
              hint:
                "No GA4 property matched this site's URL. Run ga_list_properties to see what exists, pass an " +
                "explicit propertyId, or create one with create_ga4_property (setup mode).",
            });
          }
          resolvedPropertyId = prop.propertyId;
          displayName = prop.displayName;
        }
        const streams = await listMeasurementIds(resolvedPropertyId);
        if (streams.length === 0) {
          return ok({
            propertyId: resolvedPropertyId,
            displayName,
            found: false,
            hint:
              "This GA4 property has no web data stream (only web streams have a Measurement ID). Add a web stream " +
              "in GA Admin → Data Streams, or use create_ga4_property to provision one.",
          });
        }
        const primary = streams[0].measurementId;
        return ok({
          propertyId: resolvedPropertyId,
          displayName,
          measurementId: primary,
          streams,
          gtagSnippet: gtagSnippet(primary),
          hint:
            streams.length > 1
              ? `Multiple web streams found; using ${primary}. Install the gtag snippet in the site <head>/layout.`
              : "Install the gtag snippet in the site <head>/layout (consent-gated if you use a consent banner).",
        });
      } catch (e) {
        return gaFail(e);
      }
    }
  );
};
