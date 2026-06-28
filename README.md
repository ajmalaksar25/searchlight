# Searchlight

An autonomous technical-SEO and analytics agent, delivered as a Model Context Protocol (MCP) server for any MCP client (Claude Code, Codex, Cursor, …). It reads your real Google Search Console and Analytics data, finds what is broken (indexing, canonical, redirect, sitemap, speed, on-page), explains it in plain language with a worry-level, then fixes it in your repository, deploys, and verifies the fix is live.

> **Status: the Search Console + Analytics + diagnosis layers and the guided `/seo-setup` skill are built and working** (validated end-to-end on a live site). Coverage reconstruction, scoring, and a dashboard are on the roadmap — see [SPEC.md](./SPEC.md).

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
SEARCHLIGHT_OAUTH_CLIENT_ID=xxx SEARCHLIGHT_OAUTH_CLIENT_SECRET=yyy npx -y @ajmalaksar/searchlight login
```
A browser opens; approve access. The token is stored at `~/.searchlight/token.json` (mode 0600). You can also let your agent do this in-conversation with the `auth_login` tool.

**3. Add to your MCP client** (Claude Desktop / generic) — no env vars needed:
```json
{
  "mcpServers": {
    "searchlight": {
      "command": "npx",
      "args": ["-y", "@ajmalaksar/searchlight", "serve"]
    }
  }
}
```
Claude Code one-liner: `claude mcp add searchlight -- npx -y @ajmalaksar/searchlight serve`.

**Flags (instead of env vars).** Toggle modes by adding a flag to `args` — no env file to edit:
- `--setup` → **full setup mode**: GA4 / GTM / verification provisioning **and** Search Console writes (sitemap submit/verify). This is the one flag you want for `/seo-setup` — it is self-sufficient, e.g. `"args": ["-y", "@ajmalaksar/searchlight", "serve", "--setup"]`
- `--write` → Search Console write tools *only* (sitemap submit/delete), without provisioning. `--setup` already implies this.
- `--no-analytics` → skip the Analytics scope

Use the same flag when signing in so the right scopes are requested: `searchlight login --setup`.

> Renamed from `gsc-mcp`: the legacy `~/.gsc-mcp` directory and `GSC_*` environment variables still resolve, so an existing install keeps working without re-authenticating.

## CLI

```
searchlight login            Sign in with Google (opens a browser)
searchlight logout           Remove the stored token
searchlight status           Authentication + onboarding status
searchlight setup            Guided first-run
searchlight sites …          Manage the property registry (list / add / remove / default)
searchlight serve            Start the MCP server over stdio (default)
```

## Multi-site

`siteUrl` is optional on every tool. It resolves in order: **explicit arg → session active site → persisted default**. Register friendly aliases so you can say "the blog":

```bash
searchlight sites add blog sc-domain:example.com
searchlight sites default blog
```
In chat: `use_site` switches the active property; `account_overview` gives a portfolio view across all properties.

## Tools

`auth_status`, `auth_login`, `list_sites`, `use_site`, `get_active_site`, `set_default_site`, `account_overview`, `gsc_deep_link`, `query_search_analytics`, `top_queries`, `top_pages`, `find_opportunities`, `compare_periods`, `inspect_url`, `coverage_report`, `refresh_coverage`, `get_pages_in_bucket`, `diagnose_site`, `snapshot_baseline`, `list_snapshots`, `progress_report`, `ga_list_properties`, `ga_measurement_id`, `ga_traffic`, `ga_top_pages`, `ga_report`, `list_sitemaps`, `get_sitemap`. With `SEARCHLIGHT_ENABLE_WRITE=1` (or `--write` / `--setup`): `submit_sitemap`, `delete_sitemap`.

**Coverage report** (`refresh_coverage` → `coverage_report` → `get_pages_in_bucket`) reconstructs the "Page indexing" report the GSC API won't export in bulk: it gathers candidate URLs from your sitemaps and analytics, inspects them within the 2,000/day per-property quota (resumable), caches the results under `~/.searchlight/sites/`, and buckets them by index status.

**Baseline & progress** (`snapshot_baseline` → … fix things … → `snapshot_baseline` → `progress_report`) freeze a site's `diagnose_site` health (score, indexed counts, 28-day traffic, the actionable issue list) on a given day under `~/.searchlight/sites/<hash>/snapshots/<date>.json`, then diff two days into a plain-English report of what improved — which issues were resolved, which are new, and how the score and traffic moved. This makes before→after provable.

## Develop & extend

```bash
npm install
npm run build
npm test
```

The server is a tool registry. To add a capability, create `src/tools/<group>.ts` exporting `register: ToolModule`, then add it to `MODULES` in `src/tools/index.ts`. Each module receives the `McpServer` and a shared `ToolContext` (auth, GSC client, site resolution). See the architecture notes in [SPEC.md](./SPEC.md).

## License

MIT © Ajmal Aksar
