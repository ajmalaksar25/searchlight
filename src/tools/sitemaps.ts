import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { writeEnabled } from "../auth.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "list_sitemaps",
    {
      title: "List sitemaps",
      description:
        "List all sitemaps submitted for a property, with processing status and error/warning counts.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const gsc = await ctx.gsc();
        const res = await gsc.sitemaps.list({ siteUrl: resolved });
        return ok(res.data.sitemap ?? []);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "get_sitemap",
    {
      title: "Get sitemap",
      description: "Get detailed status for a single sitemap by its full feed URL.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        feedpath: z.string().describe("Full URL of the sitemap, e.g. https://example.com/sitemap.xml"),
      },
    },
    async ({ siteUrl, feedpath }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const gsc = await ctx.gsc();
        const res = await gsc.sitemaps.get({ siteUrl: resolved, feedpath });
        return ok(res.data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // Write tools register only when GSC_ENABLE_WRITE is set.
  if (!writeEnabled()) return;

  server.registerTool(
    "submit_sitemap",
    {
      title: "Submit sitemap",
      description: "Submit (or resubmit) a sitemap for a property. Requires write scope.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        feedpath: z.string().describe("Full URL of the sitemap to submit."),
      },
    },
    async ({ siteUrl, feedpath }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const gsc = await ctx.gsc();
        await gsc.sitemaps.submit({ siteUrl: resolved, feedpath });
        return ok({ submitted: feedpath, siteUrl: resolved });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "delete_sitemap",
    {
      title: "Delete sitemap",
      description: "Remove a sitemap from a property. Requires write scope.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        feedpath: z.string().describe("Full URL of the sitemap to delete."),
      },
    },
    async ({ siteUrl, feedpath }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const gsc = await ctx.gsc();
        await gsc.sitemaps.delete({ siteUrl: resolved, feedpath });
        return ok({ deleted: feedpath, siteUrl: resolved });
      } catch (e) {
        return fail(e);
      }
    }
  );
};
