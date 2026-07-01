# Deploying Searchlight

Searchlight is a local, self-hosted [Model Context Protocol](https://modelcontextprotocol.io)
server for technical SEO and analytics. It runs on **your** machine, signs in with **your**
Google account, and stores its token and cache only on your device — there is no hosted backend.

This guide is for someone self-hosting the server and wiring it into an AI client (Claude Code,
Codex, or any MCP client), plus running the CLI headless for scheduled jobs.

---

## 1. Requirements

- **Node.js ≥ 18** (declared in `engines`). Newer LTS versions are fine.
- **npm** (ships with Node) to install and build.
- A **Google account** with access to the Search Console / Analytics properties you want to work on.
- Optional: your **own PageSpeed Insights API key** if you would rather run Core Web Vitals
  calls against your own project quota instead of the bundled key (the page-speed tools work
  out of the box without one — see §6).

Runtime dependencies (installed for you by `npm install`):

- `@modelcontextprotocol/sdk` — MCP server + stdio transport
- `googleapis` — Search Console, Analytics, Site Verification, OAuth
- `cheerio` — HTML parsing for the live-site crawler
- `open` — launches the browser for OAuth sign-in
- `zod` — tool input schemas

Build-time only: `typescript`, `@types/node`.

---

## 2. Install (from source)

There is no published npm package yet, so install from a clone. The `npm`/`npx` path in the
examples below is the intended future distribution — until then, build locally.

```bash
git clone https://github.com/ajmalaksar25/searchlight.git
cd searchlight
npm install
npm run build      # tsc -> compiles src/ to dist/
```

The build produces `dist/index.js`, which is the CLI/server entry point (declared as the
`searchlight` bin). You can invoke it two ways:

```bash
node dist/index.js <command>          # always works from the repo root

# or expose the `searchlight` command globally:
npm install -g .                      # or: npm link
searchlight <command>
```

Throughout this doc, `searchlight <command>` and `node dist/index.js <command>` are
interchangeable. Once the package is published, the same commands become
`npx -y @ajmalaksar/searchlight <command>`.

---

## 3. First-run authentication

Sign in once with a local browser OAuth flow. The server spins up a temporary loopback
listener on `127.0.0.1`, opens Google's consent screen, captures the code, and writes the
token to disk (mode `0600`).

```bash
searchlight login
```

If the browser does not open, the authorization URL is printed to the terminal — paste it
manually. On success the token is stored at `~/.searchlight/token.json`.

### Choosing scopes with flags

The scopes requested depend on flags. **Log in with the same flags you plan to `serve` with**,
so the stored token carries the scopes the server needs.

| Flag | Env equivalent | Effect on scopes |
|---|---|---|
| *(none)* | — | `webmasters.readonly` + `analytics.readonly` — read-only GSC + GA |
| `--write` | `SEARCHLIGHT_ENABLE_WRITE=1` | Upgrades GSC to the full `webmasters` scope, enabling `submit_sitemap` / `delete_sitemap` |
| `--setup` | `SEARCHLIGHT_ENABLE_SETUP=1` | Implies `--write`, and adds `siteverification` + `analytics.edit` for GA4 / verification provisioning |
| `--no-analytics` | `SEARCHLIGHT_DISABLE_ANALYTICS=1` | Drops the `analytics.readonly` scope (GSC only) |

- Use **`--write`** if you want the agent to submit or delete sitemaps but nothing more.
- Use **`--setup`** for the full guided loop (create a GA4 property, get a verification token,
  verify a site). `--setup` alone is enough — it already grants write, so you don't also need `--write`.

Examples:

```bash
searchlight login --setup          # full read/write + provisioning scopes
searchlight login --write          # read + sitemap write
searchlight login --no-analytics   # Search Console only
```

If Google returns no refresh token, the CLI warns you: revoke the app at
`https://myaccount.google.com/permissions` and log in again.

### OAuth client credentials

Login needs an OAuth **client** (separate from your user token). Resolution order:

1. `SEARCHLIGHT_OAUTH_CLIENT_ID` + `SEARCHLIGHT_OAUTH_CLIENT_SECRET`
2. `SEARCHLIGHT_OAUTH_CREDENTIALS` = path to a `client_secret.json` downloaded from Google Cloud
3. `SEARCHLIGHT_BUNDLED_CLIENT_ID` + `SEARCHLIGHT_BUNDLED_CLIENT_SECRET` (env-provided bundled client)
4. A **bundled client** file shipped with the package (`bundled-client.json`)

If none is present, `login` fails with a "Missing OAuth client credentials" error.

**Bring your own OAuth client:** create a project at
`https://console.cloud.google.com/`, enable the **Google Search Console API** and the
**Analytics Data + Analytics Admin APIs** (and the **Site Verification API** if you use
`--setup`), configure the OAuth consent screen as *External* and add yourself as a test user,
create an OAuth client ID of type **Desktop app**, then set
`SEARCHLIGHT_OAUTH_CLIENT_ID` / `SEARCHLIGHT_OAUTH_CLIENT_SECRET` (or point
`SEARCHLIGHT_OAUTH_CREDENTIALS` at the downloaded JSON) before running `login`. (The
PageSpeed Insights tools authenticate with an API key, not this OAuth client, so you do not
need to enable the PSI API for a bring-your-own OAuth client — see §6 for the PSI key.)

Check where you stand at any time:

```bash
searchlight status     # auth state, token path, granted scopes, default site, next step
searchlight setup      # guided next step (prints the Google Cloud walkthrough if needed)
```

---

## 4. Add it to an MCP client

The server speaks MCP over **stdio**. The command to run is `searchlight serve` (or bare
`searchlight` — `serve` is the default when no subcommand is given). Pass the same feature
flags you used at login.

### Claude Code

Once published (future path):

```bash
claude mcp add searchlight -- npx -y @ajmalaksar/searchlight serve --setup
```

From a source build today, point it at your compiled entry:

```bash
claude mcp add searchlight -- node /absolute/path/to/searchlight/dist/index.js serve --setup
```

### Generic MCP client (config JSON)

Published path:

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

Source build:

```json
{
  "mcpServers": {
    "searchlight": {
      "command": "node",
      "args": ["/absolute/path/to/searchlight/dist/index.js", "serve", "--setup"]
    }
  }
}
```

Flags go in the `args` array — e.g. `["serve", "--setup"]` or `["serve", "--write"]`. They
map to the same env vars as in §3, so you can set those in the client's `env` block instead if
you prefer. The server logs (`searchlight server running on stdio.`) go to **stderr**; stdout
is reserved for the JSON-RPC channel.

### Install the agent skill (optional)

`skill install` drops the `/searchlight` skill into your AI client so the agent orchestrates
the whole detect → explain → fix → deploy → verify loop instead of you calling raw tools:

```bash
searchlight skill install          # ~/.claude/skills/searchlight  (user-global)
searchlight skill install --here   # ./.claude/skills/searchlight  (current project)
```

Then, in the client: `/searchlight audit <site>`, `/searchlight setup <site>`, or
`/searchlight fix <site>`.

---

## 5. CLI commands (headless / scheduled use)

Every command below runs without an MCP client, which makes them suitable for cron jobs and CI.
All human-readable output goes to **stderr**; only `report` writes machine-usable Markdown to
**stdout**. Wherever a command takes a site, you can pass a registered alias or a raw property
URL (`https://example.com/` or `sc-domain:example.com`).

```
searchlight login [flags]           Sign in with Google (opens a browser)
searchlight logout                  Remove the stored token
searchlight status                  Auth + onboarding status
searchlight setup                   Guided first-run: what to set up next

searchlight sites list              Show the property registry + default
searchlight sites add <alias> <siteUrl>
searchlight sites remove <alias>
searchlight sites default <alias|siteUrl>

searchlight crawl <alias|siteUrl> [--max N]     Advance the coverage crawl via URL Inspection
searchlight crawl --all [--max N]               ...across every property (default max 100)

searchlight crawl-site <alias|siteUrl> [--max N] [--reset]   Crawl the LIVE site directly
searchlight crawl-site --all [--max N]                       (no Google quota; default max 150)

searchlight audit-site <alias|siteUrl>          Site-wide technical-SEO report from the crawl
searchlight report <alias|siteUrl>              Export that audit as Markdown to stdout

searchlight serve                   Start the MCP server over stdio (default command)
searchlight skill install [--here]  Install the /searchlight skill into your AI client
```

Notes:

- **`crawl`** uses Google's URL Inspection API and is bounded by the **2,000/day per-property
  quota** — it is resumable, so schedule it to chip away at large sites. Each run reports how
  many URLs it inspected and how much quota remains.
- **`crawl-site`** fetches your live pages directly (no Google scope, no quota), following
  redirects and respecting robots. `--reset` starts the frontier over. Run this **before**
  `audit-site` / `report`.
- **`audit-site`** prints a grade, score/100, and worst-first findings. **`report`** emits the
  same audit as Markdown you can redirect to a file:

```bash
searchlight crawl-site blog --max 300
searchlight audit-site blog
searchlight report blog > audit.md
```

A minimal nightly job (build once, then):

```bash
node dist/index.js crawl-site --all --max 200
node dist/index.js report myblog > /var/reports/myblog-$(date +%F).md
```

### MCP tools exposed by `serve`

Always available (read-only): `auth_status`, `auth_login`, `list_sites`, `use_site`,
`get_active_site`, `set_default_site`, `account_overview`, `gsc_deep_link`,
`query_search_analytics`, `find_opportunities`, `compare_periods`, `inspect_url`,
`coverage_report`, `refresh_coverage`, `crawl_site`, `site_audit`, `export_report`,
`diagnose_site`, `audit_page`, `page_speed`, `snapshot_baseline`, `list_snapshots`,
`progress_report`, `ga_list_properties`, `ga_measurement_id`, `ga_report`, `list_sitemaps`,
`setup_status`.

With `--write` (or `--setup`): `submit_sitemap`, `delete_sitemap`.

With `--setup` only: the GA4 / verification provisioning tools — `list_ga_accounts`,
`create_ga4_property`, `get_verification_token`, `verify_site`. (`--write` alone does not
expose these; it never grants the `siteverification` / `analytics.edit` scopes they need.)

---

## 6. Configuration and data locations

All state lives under a single config directory. Precedence:

1. `SEARCHLIGHT_HOME` (or legacy `GSC_MCP_HOME`) if set
2. `~/.searchlight` (default)
3. If `~/.searchlight` doesn't exist but the legacy `~/.gsc-mcp` does, the legacy dir is reused
   (seamless upgrade from the old `gsc-mcp` name — no re-authentication needed)

Layout:

```
~/.searchlight/
  token.json          OAuth tokens (mode 0600)
  config.json         property registry + default site
  sites/<hash>/       per-site cache, coverage results, snapshots, reports
  sites/<hash>/snapshots/<YYYY-MM-DD>.json   baseline snapshots
```

Environment variables (each `SEARCHLIGHT_*` name also accepts the legacy `GSC_*` prefix as a
fallback, so pre-rename setups keep working):

| Variable | Purpose |
|---|---|
| `SEARCHLIGHT_HOME` | Override the config/data directory |
| `SEARCHLIGHT_OAUTH_CLIENT_ID` / `SEARCHLIGHT_OAUTH_CLIENT_SECRET` | Bring-your-own OAuth client |
| `SEARCHLIGHT_OAUTH_CREDENTIALS` | Path to a downloaded `client_secret.json` (alternative to the two above) |
| `SEARCHLIGHT_BUNDLED_CLIENT_ID` / `SEARCHLIGHT_BUNDLED_CLIENT_SECRET` | Maintainer bundled client (usually left to `bundled-client.json`) |
| `SEARCHLIGHT_DEFAULT_SITE` | Property used when a tool call omits `siteUrl` and no session site is set |
| `SEARCHLIGHT_PAGESPEED_API_KEY` | PageSpeed Insights API key — overrides the bundled quota key so calls run against your own project quota (the page-speed / Core Web Vitals tools already work without it, using the bundled key) |
| `SEARCHLIGHT_CRUX_API_KEY` | CrUX API key (falls back to the PageSpeed key if unset) |
| `SEARCHLIGHT_ENABLE_WRITE` | Same as `--write` |
| `SEARCHLIGHT_ENABLE_SETUP` | Same as `--setup` |
| `SEARCHLIGHT_DISABLE_ANALYTICS` | Same as `--no-analytics` |

A starter `.env.example` ships with the repo. Note it currently lists the legacy `GSC_*`
names; the `SEARCHLIGHT_*` equivalents above are preferred and take precedence.

---

## 7. What ships in the package

The published tarball (the `files` allowlist) contains only:

- `dist/` — the compiled server and CLI (`dist/index.js` is the `searchlight` bin)
- `skill/` — the `/searchlight` agent skill installed by `skill install`
- `bundled-client.json` — the optional bundled OAuth client (so most users can skip Google Cloud setup)
- `bundled-keys.json` — the optional bundled PageSpeed / CrUX API keys
- `README.md`
- `.env.example`

Source (`src/`), tests, and dev config are not shipped — they exist only in the repository.

---

## License

MIT © Ajmal Aksar
