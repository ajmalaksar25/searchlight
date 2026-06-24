import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolContext } from "./context.js";
import { registerAllTools } from "./tools/index.js";

/** Build a fully wired MCP server. One ToolContext per server (per connection). */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "gsc-mcp", version: "0.1.0" });
  const ctx = new ToolContext();
  registerAllTools(server, ctx);
  return server;
}

export async function startServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the JSON-RPC channel.
  console.error("gsc-mcp server running on stdio.");
}
