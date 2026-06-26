import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { pageSpeed } from "../speed.js";
import type { ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  void ctx;
  server.registerTool(
    "page_speed",
    {
      title: "Page speed & Core Web Vitals",
      description:
        "Measure a page's speed via PageSpeed Insights: the Lighthouse lab score plus real-user Core Web Vitals " +
        "(LCP, INP, CLS) from CrUX when available, with plain-English findings on what's slow and how to fix it. " +
        "Requires a PageSpeed API key.",
      inputSchema: {
        url: z.string().describe("The full public URL to test."),
        strategy: z
          .enum(["mobile", "desktop"])
          .optional()
          .describe("Device profile. Default mobile (Google indexes mobile-first)."),
      },
    },
    async ({ url, strategy }) => {
      try {
        return ok(await pageSpeed(url, strategy ?? "mobile"));
      } catch (e) {
        return fail(e);
      }
    }
  );
};
