import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../context.js";

/** Every tool module exports a register() with this signature. */
export type ToolModule = (server: McpServer, ctx: ToolContext) => void;

export const SITE_URL_DESC =
  'Property as shown in Search Console: a URL-prefix property ends with a slash ' +
  '(e.g. "https://example.com/") or a domain property uses "sc-domain:example.com". ' +
  "May be a registered alias, or omitted to use the active/default site.";

/** siteUrl is optional everywhere now — it resolves to the active/default site. */
export const siteUrlOptional = z.string().optional().describe(SITE_URL_DESC);
