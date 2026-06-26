import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../context.js";
import { register as diagnostics } from "./diagnostics.js";
import { register as sites } from "./sites.js";
import { register as analytics } from "./analytics.js";
import { register as insights } from "./insights.js";
import { register as inspection } from "./inspection.js";
import { register as coverage } from "./coverage.js";
import { register as sitemaps } from "./sitemaps.js";
import type { ToolModule } from "./shared.js";

/**
 * The tool registry. To add a capability, drop a new module under src/tools/
 * that exports `register: ToolModule`, then add it here. Each module gets the
 * server and the shared ToolContext (auth, GSC client, site resolution).
 */
const MODULES: ToolModule[] = [
  diagnostics,
  sites,
  analytics,
  insights,
  inspection,
  coverage,
  sitemaps,
];

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  for (const register of MODULES) register(server, ctx);
}
