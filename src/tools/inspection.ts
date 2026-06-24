import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "inspect_url",
    {
      title: "Inspect URL",
      description:
        "Run the URL Inspection tool on a single URL: index status, coverage, last crawl, canonical, mobile " +
        "usability and rich-results state. Use this to diagnose why a page is or is not indexed. " +
        "Subject to a 2,000/day per-property quota.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        inspectionUrl: z.string().describe("The full URL to inspect. Must belong to the property."),
        languageCode: z.string().optional().describe("BCP-47 code, e.g. 'en-US'. Default en-US."),
      },
    },
    async ({ siteUrl, inspectionUrl, languageCode }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const gsc = await ctx.gsc();
        const res = await gsc.urlInspection.index.inspect({
          requestBody: { siteUrl: resolved, inspectionUrl, languageCode: languageCode ?? "en-US" },
        });
        return ok(res.data.inspectionResult ?? {});
      } catch (e) {
        return fail(e);
      }
    }
  );
};
