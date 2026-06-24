import { z } from "zod";
import { ok, fail, round } from "../util/result.js";
import { runSearchAnalytics, daysAgo } from "../gsc.js";
import { loadConfig, defaultSite, setDefaultSite } from "../config.js";
import { buildDeepLink } from "../deeplinks.js";
import { siteUrlOptional, SITE_URL_DESC, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "list_sites",
    {
      title: "List sites",
      description:
        "List every Search Console property the signed-in user can access, with permission level, " +
        "any registered alias, and which property is currently active / default.",
      inputSchema: {},
    },
    async () => {
      try {
        const gsc = await ctx.gsc();
        const res = await gsc.sites.list();
        const cfg = loadConfig();
        const def = defaultSite(cfg);
        const active = ctx.getActiveSite();
        const aliasOf = (url: string) =>
          cfg.sites.find((s) => s.siteUrl === url)?.alias;
        const entries = (res.data.siteEntry ?? []).map((s) => ({
          siteUrl: s.siteUrl,
          permissionLevel: s.permissionLevel,
          alias: s.siteUrl ? aliasOf(s.siteUrl) ?? null : null,
          active: s.siteUrl === active,
          default: s.siteUrl === def,
        }));
        return ok({ count: entries.length, sites: entries });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "use_site",
    {
      title: "Switch active site",
      description:
        "Set the active property for this session, so later tool calls can omit siteUrl. " +
        'Accepts a property URL or a registered alias (e.g. "blog"). The primary way to switch context.',
      inputSchema: { site: z.string().describe(SITE_URL_DESC) },
    },
    async ({ site }) => {
      try {
        const siteUrl = ctx.setActiveSite(site);
        return ok({ activeSite: siteUrl, note: "Later calls can omit siteUrl." });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "get_active_site",
    {
      title: "Get active site",
      description:
        "Report which property tool calls currently target, and whether it came from the session, the default, or none.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = ctx.resolveSite();
        return ok({ siteUrl: r.siteUrl, source: r.source });
      } catch {
        return ok({
          siteUrl: null,
          source: "none",
          hint: "No active or default site. Call use_site or set_default_site.",
        });
      }
    }
  );

  server.registerTool(
    "set_default_site",
    {
      title: "Set default site",
      description:
        "Persist the default property to config.json (survives restarts). Used when a call omits siteUrl " +
        "and no session site is set. Accepts a property URL or alias.",
      inputSchema: { site: z.string().describe(SITE_URL_DESC) },
    },
    async ({ site }) => {
      try {
        const cfg = setDefaultSite(site);
        return ok({ defaultSite: cfg.defaultSite });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "account_overview",
    {
      title: "Account overview (all sites)",
      description:
        "Portfolio view across every accessible property: last-28-day clicks and impressions per site, " +
        "ranked. (Per-site SEO/coverage scores are added in a later phase.)",
      inputSchema: {
        days: z.number().int().min(1).max(480).optional().describe("Lookback window. Default 28."),
      },
    },
    async ({ days }) => {
      try {
        const gsc = await ctx.gsc();
        const res = await gsc.sites.list();
        const cfg = loadConfig();
        const sites = (res.data.siteEntry ?? [])
          .map((s) => s.siteUrl)
          .filter((u): u is string => Boolean(u));
        const start = daysAgo((days ?? 28) + 2);
        const end = daysAgo(2);
        const rows = await Promise.all(
          sites.map(async (siteUrl) => {
            try {
              const data = await runSearchAnalytics({ siteUrl, startDate: start, endDate: end, rowLimit: 1 });
              const r = data.rows?.[0];
              return {
                siteUrl,
                alias: cfg.sites.find((s) => s.siteUrl === siteUrl)?.alias ?? null,
                clicks: r?.clicks ?? 0,
                impressions: r?.impressions ?? 0,
                ctr: round(r?.ctr ?? 0, 4),
                position: round(r?.position ?? 0, 1),
              };
            } catch (err) {
              return { siteUrl, error: err instanceof Error ? err.message : String(err) };
            }
          })
        );
        rows.sort((a, b) => ((b as { clicks?: number }).clicks ?? 0) - ((a as { clicks?: number }).clicks ?? 0));
        return ok({ window: [start, end], sites: rows });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "gsc_deep_link",
    {
      title: "Deep link to Search Console UI",
      description:
        "Return the exact Search Console UI URL for a report the API does not expose " +
        "(removals, manual actions, security issues, page-indexing). Hand this to the user to act on.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        report: z
          .enum(["removals", "manualActions", "securityIssues", "pageIndexing", "overview"])
          .describe("Which Search Console report to open."),
      },
    },
    async ({ siteUrl, report }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok({ siteUrl: resolved, report, url: buildDeepLink(resolved, report) });
      } catch (e) {
        return fail(e);
      }
    }
  );
};
