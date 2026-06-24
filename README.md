# gsc-mcp

A Model Context Protocol (MCP) server that turns Google Search Console into an SEO copilot for any MCP client (Claude Desktop, Claude Code, Cursor, …). Query search analytics, inspect URLs, manage sitemaps, switch between properties, and surface SEO opportunities — in plain language.

> **Status: Phase 1.** The GSC data layer + multi-site + onboarding are built and working. Coverage-report reconstruction, on-page audits, page-speed, scoring, and a dashboard are on the roadmap — see [SPEC.md](./SPEC.md).

## Install & connect (Tier 0: bring-your-own Google client)

A hosted "just sign in" client is coming; for now you create a one-time Google Cloud client.

**1. Google Cloud (once):**
1. Create or pick a project at <https://console.cloud.google.com/>.
2. Enable the **Google Search Console API** (and, later, the **PageSpeed Insights API**).
3. **OAuth consent screen** → **External** → add your Google account as a **test user** (test users skip app verification).
4. **Credentials** → **Create OAuth client ID** → type **Desktop app**.
5. Copy the **Client ID** and **Client secret**.

**2. Sign in (once):**
```bash
GSC_OAUTH_CLIENT_ID=xxx GSC_OAUTH_CLIENT_SECRET=yyy npx -y @ajmalaksar/gsc-mcp login
```
A browser opens; approve access. The token is stored at `~/.gsc-mcp/token.json` (mode 0600). You can also let Claude do this in-conversation with the `auth_login` tool.

**3. Add to your MCP client** (Claude Desktop / generic):
```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "@ajmalaksar/gsc-mcp", "serve"],
      "env": {
        "GSC_OAUTH_CLIENT_ID": "xxx",
        "GSC_OAUTH_CLIENT_SECRET": "yyy",
        "GSC_DEFAULT_SITE": "sc-domain:example.com"
      }
    }
  }
}
```
Claude Code one-liner: `claude mcp add gsc -- npx -y @ajmalaksar/gsc-mcp serve`.

## CLI

```
gsc-mcp login            Sign in with Google (opens a browser)
gsc-mcp logout           Remove the stored token
gsc-mcp status           Authentication + onboarding status
gsc-mcp setup            Guided first-run
gsc-mcp sites …          Manage the property registry (list / add / remove / default)
gsc-mcp serve            Start the MCP server over stdio (default)
```

## Multi-site

`siteUrl` is optional on every tool. It resolves in order: **explicit arg → session active site → persisted default**. Register friendly aliases so you can say "the blog":

```bash
gsc-mcp sites add blog sc-domain:example.com
gsc-mcp sites default blog
```
In chat: `use_site` switches the active property; `account_overview` gives a portfolio view across all properties.

## Tools (Phase 1)

`auth_status`, `auth_login`, `list_sites`, `use_site`, `get_active_site`, `set_default_site`, `account_overview`, `gsc_deep_link`, `query_search_analytics`, `top_queries`, `top_pages`, `find_opportunities`, `compare_periods`, `inspect_url`, `list_sitemaps`, `get_sitemap`. With `GSC_ENABLE_WRITE=1`: `submit_sitemap`, `delete_sitemap`.

## Develop & extend

```bash
npm install
npm run build
npm test
```

The server is a tool registry. To add a capability, create `src/tools/<group>.ts` exporting `register: ToolModule`, then add it to `MODULES` in `src/tools/index.ts`. Each module receives the `McpServer` and a shared `ToolContext` (auth, GSC client, site resolution). See the architecture notes in [SPEC.md](./SPEC.md).

## License

MIT © Ajmal Aksar
