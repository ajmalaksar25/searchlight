import { ok, fail } from "../util/result.js";
import { diagnoseSite } from "../diagnose.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "diagnose_site",
    {
      title: "Diagnose site health (why + what to do)",
      description:
        "A plain-English health report for a property: an overall score + headline, and findings triaged into " +
        "'fix now' (critical), 'worth improving', 'looks scary but is fine', and 'working' — each with WHY it " +
        "matters and what to do about it. Combines cached coverage with live checks (sitemap + robots " +
        "reachability) and 28-day traffic. Run refresh_coverage first for the fullest picture.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok(await diagnoseSite(resolved));
      } catch (e) {
        return fail(e);
      }
    }
  );
};
