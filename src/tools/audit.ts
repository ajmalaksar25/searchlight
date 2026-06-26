import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { auditPage } from "../audit.js";
import type { ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  void ctx;
  server.registerTool(
    "audit_page",
    {
      title: "Audit a page (on-page SEO + fixes)",
      description:
        "Fetch a live URL and report fixable on-page issues with WHY + what to do: title, meta description, " +
        "canonical, H1, mobile viewport, Open Graph / Twitter social preview, structured data, alt text, internal " +
        "links, content depth, and whether a Google Analytics tag is present. Returns a score and the detected " +
        "framework. Works on any public URL.",
      inputSchema: {
        url: z.string().describe("The full public URL of the page to audit, e.g. https://example.com/blog/post"),
      },
    },
    async ({ url }) => {
      try {
        return ok(await auditPage(url));
      } catch (e) {
        return fail(e);
      }
    }
  );
};
