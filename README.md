<div align="center">

# Searchlight

**Technical SEO that fixes itself.**

An autonomous technical-SEO and analytics agent, delivered as a Model Context Protocol (MCP)
server. Point it at your site: it finds what's broken, explains it in plain language, fixes it
in your repository, deploys, and verifies the fix is live.

[Website](https://searchlight.ajmalaksar.com) ·
[The `/searchlight` skill](#the-searchlight-skill) ·
[Quickstart](#quickstart) ·
[Tools](#tools)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
&nbsp;[![Model Context Protocol](https://img.shields.io/badge/MCP-server-111?logo=anthropic)](https://modelcontextprotocol.io)
&nbsp;![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg)

</div>

---

## The loop

Most SEO tools stop at the diagnosis. Searchlight runs the whole loop and proves the last step.

| Step | What it does |
|---|---|
| **Detect** | Reads your Search Console and Analytics data, crawls key pages, finds indexing, canonical, redirect, sitemap, speed and on-page issues. |
| **Explain** | Triages every finding in plain language with a worry-level: fix now, worth improving, or normal and safe to ignore. |
| **Fix** | Edits your repository, framework-aware: canonical and host conflicts, redirect loops, sitemaps, metadata, structured data, the analytics tag. |
| **Deploy** | Commits and ships through your existing pipeline. Edits only count once they are live. |
| **Verify** | Re-audits the live site and confirms the fix in a real browser: the redirect resolves, the tag fires, the canonical agrees. |

### Proof

A live run on **zawaaj.in** (a custom Next.js site with a host and canonical conflict and
missing analytics) went from audit **90 → 98** — canonical set, host redirect aligned
(`www → apex`), meta trimmed, GA4 installed and verified firing, sitemap submitted — in about
**50 minutes** (≈25 minutes active; the rest idle waiting on a redeploy), versus a 4–6 hour
manual baseline for a skilled developer. The full annotated run is on the
[website](https://searchlight.ajmalaksar.com/#proof).

> Searchlight automates the diagnosis and the fix. It does **not** design your ecommerce
> event-tracking plan — that part is still a human's job.

---

## Quickstart

**1. Add it to your MCP client** (Claude Code shown; works in any MCP client):

```bash
claude mcp add searchlight -- npx -y @ajmalaksar/searchlight serve --setup
```

Or, in a generic client config:

```json
{
  "mcpServers": {
    "searchlight": { "command": "npx", "args": ["-y", "@ajmalaksar/searchlight", "serve"] }
  }
}
```

**2. Sign in with Google** (one local OAuth sign-in for Search Console and Analytics; the token
is stored only on your machine):

```bash
npx -y @ajmalaksar/searchlight login --setup
```

**3. Install the `/searchlight` skill** so your agent runs the whole loop with one command:

```bash
npx -y @ajmalaksar/searchlight skill install
```

**4. Ask:**

```text
/searchlight audit zawaaj.in
```

> First time on Google Cloud? The bundled client lets most users skip setup. To bring your own
> (Tier 0), create a **Desktop app** OAuth client (enable the *Google Search Console API* and
> *PageSpeed Insights API*, add yourself as a test user) and pass
> `SEARCHLIGHT_OAUTH_CLIENT_ID` / `SEARCHLIGHT_OAUTH_CLIENT_SECRET` to `login`.
>
> Renamed from `gsc-mcp`: the legacy `~/.gsc-mcp` directory and `GSC_*` environment variables
> still resolve, so an existing install keeps working without re-authenticating.

---

## The `/searchlight` skill

`skill install` drops a skill into your AI client so the agent orchestrates the full loop
instead of you calling raw tools. It routes on the first word:

| Command | Does |
|---|---|
| `/searchlight audit [site]` | Read-only diagnosis: detect + explain, triaged. No changes. |
| `/searchlight setup [site]` | The full guided loop: interview → detect → confirm → provision → fix → deploy → verify. |
| `/searchlight fix [site]` | Already audited? Go straight to plan → confirm → fix → deploy → verify. |

It always confirms before any provisioning, code edit, sitemap submit, or deploy.

---

## Tools

`auth_status`, `auth_login`, `list_sites`, `use_site`, `get_active_site`, `set_default_site`,
`account_overview`, `gsc_deep_link`, `query_search_analytics`, `top_queries`, `top_pages`,
`find_opportunities`, `compare_periods`, `inspect_url`, `coverage_report`, `refresh_coverage`,
`get_pages_in_bucket`, `diagnose_site`, `snapshot_baseline`, `list_snapshots`, `progress_report`,
`ga_list_properties`, `ga_measurement_id`, `ga_traffic`, `ga_top_pages`, `ga_report`,
`list_sitemaps`, `get_sitemap`. With `--write` / `--setup`: `submit_sitemap`, `delete_sitemap`,
and the GA4 / verification provisioning tools.

**Coverage report** reconstructs the "Page indexing" report the GSC API won't export in bulk:
it gathers candidate URLs from sitemaps and analytics, inspects them within the 2,000/day
per-property quota (resumable), caches the results under `~/.searchlight/sites/`, and buckets
them by index status.

**Baseline & progress** (`snapshot_baseline` → … fix … → `snapshot_baseline` → `progress_report`)
freeze a site's health on a given day, then diff two days into a plain-English before→after of
what improved — which issues resolved, which are new, and how score and traffic moved.

---

## Local-first & private

Searchlight runs as a **local** server. You sign in with your own Google account; the token is
stored only on your device. There is no hosted backend and no data warehouse — each person runs
their own. Read-only by default; write and provisioning scopes are opt-in, requested only when
you start a setup action. Open source and MIT licensed. See the [Privacy Policy](https://searchlight.ajmalaksar.com/privacy).

---

## CLI

```
searchlight login            Sign in with Google (opens a browser)
searchlight logout           Remove the stored token
searchlight status           Authentication + onboarding status
searchlight setup            Guided first-run
searchlight sites …          Manage the property registry (list / add / remove / default)
searchlight skill install    Install the /searchlight skill into your AI client (--here for this project)
searchlight serve            Start the MCP server over stdio (default)
```

## Develop

```bash
npm install
npm run build
npm test
```

The server is a tool registry. To add a capability, create `src/tools/<group>.ts` exporting
`register: ToolModule`, then add it to `MODULES` in `src/tools/index.ts`. See [SPEC.md](./SPEC.md)
for the architecture.

## License

MIT © Ajmal Aksar
