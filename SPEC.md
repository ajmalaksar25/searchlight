# Searchlight

A build-ready spec for an MCP server (+ a skill + a local dashboard) that lets any LLM client query Google Search Console, **reconstruct the indexing/coverage report the API won't give you in bulk, audit live pages for concrete fixes, score SEO / E‑E‑A‑T / GEO, and present it all in a document a human or Claude can act on.** Hand this file to Claude Code as the source of truth.

> A working reference scaffold already exists in this folder (`package.json`, `tsconfig.json`, `src/`). Treat it as a head start, not a constraint.

> **This is v2.** v1 was a read-only GSC data wrapper. v2 reframes the product around how an SEO marketer actually works: *discover a problem → understand why → know what to change on the page → change it → verify*. The GSC API covers the first third; the rest is the differentiator.

---

## 0. The reframe (read this first)

A marketer's loop is **discover → understand → fix → verify**. GSC (and a thin wrapper over it) tells you *what* is wrong but never *how to fix your specific page*. That "how" gap is the whole opportunity. So this is not "a GSC wrapper" — it is a **4-layer SEO copilot**:

| Layer | What it is | Where it lives |
| --- | --- | --- |
| **1. Data access** | GSC tools + PageSpeed/CrUX + **on-page fetch & audit** | MCP tools (`src/tools/`) |
| **2. Derived state** | a cached, generated **Site SEO Report** — coverage buckets, scores, ranked opportunities | cache + report generator |
| **3. Judgment** | the **`gsc-seo` skill** — turns data into prioritized, concrete fixes grounded in Google's guide; delegates to `ai-seo` / `seo-content-writer` | `skill/` |
| **4. Presentation** | a local **Vite dashboard** + **MCP Apps widgets** + a static HTML report | `dashboard/`, UI resources |

---

## 1. Goal and scope

Build a TypeScript MCP server, distributed on npm, that exposes Google Search Console as LLM-callable tools, **enriches it with on-page analysis and page-speed data the GSC API lacks**, and renders the result as a document for humans and Claude. Plug-and-play at runtime: one line in an MCP client config, one browser sign-in.

**In scope (v2)**
- Read search analytics (clicks, impressions, CTR, position) by any dimension and date range.
- Per-URL inspection **and** a reconstructed, cached **coverage/indexing report** bucketed exactly like the GSC "Page indexing" report (see §2, §7).
- Sitemap read; optional submit/delete behind a write flag.
- Site/property listing **with a friendly-alias registry, a default/active site, switching, and a cross-property `account_overview`** (§11).
- **On-page audit** (`audit_page`): fetch the live URL and report concrete, fixable issues — titles, meta, canonical, headings, OG/Twitter previews, structured data, alt text, internal links, distractions — each with a suggested edit (§9). This is OG Fixer generalized.
- **Page speed / Core Web Vitals** via PageSpeed Insights + CrUX APIs (§10).
- **SEO / E‑E‑A‑T / GEO scores** with a "what to fix first" list (§8).
- Higher-level insight tools (striking-distance, low-CTR, period movers).
- A generated **Site SEO Report** artifact (`report.json` / `.md` / `.html`) — the single document everything reads from (§6).
- A local **Vite dashboard** to list sites, switch, drill in, and trigger refreshes (§15).
- A **`gsc-seo` skill** so non-technical users get the workflow, not raw tools (§14).

**Out of scope (v2)**
- Writing or editing page content (we *suggest* edits; we don't apply them to the user's site).
- A hosted multi-tenant backend. This stays local and single-tenant; each user runs their own. (A hosted product is a separate, later thing — do not blur it in.)
- Google Analytics / Ads.
- Bulk historical warehousing of analytics. Coverage *is* cached (it has to be — see §7); analytics stays mostly on-demand.

**Non-negotiables**
- Zero friction from install to first result. The default path is **install → click sign-in → done**: a one-click bundle or one-line config, a hosted "just sign in with Google" client (no Google Cloud setup), and login that can happen **in-conversation** (§5.6). After the one-time login, auth never resurfaces (tokens auto-refresh). A *hosted OAuth client* is only a shared app registration — tokens and the server still run locally, so this stays local/single-tenant.
- Safe by default. Read-only scope unless the user opts into write. No write action ever touches the live site except sitemap submit/delete behind the flag.
- Clear errors. Every tool returns a human-readable reason, never a raw stack trace.
- **Honest about limits.** The API cannot do everything the GSC UI does (§2). We never pretend otherwise; we reconstruct what we can and deep-link the rest.
- **Token-disciplined output.** Tools pre-aggregate and cap samples. We never dump 25,000 rows into Claude's context (§6.4).

---

## 2. The honest API map (this constrains everything)

The GSC API exposes **exactly four services**: Search Analytics, Sitemaps, Sites, URL Inspection. Everything else in the GSC UI is **not** in the API. Building in public means we state this plainly and design around it.

| Capability the user wants | API reality | Our approach |
| --- | --- | --- |
| Search performance (clicks/impressions/CTR/position) | ✅ Search Analytics | direct |
| Sitemaps read + submit/delete | ✅ Sitemaps | read direct; write behind `SEARCHLIGHT_ENABLE_WRITE` |
| Per-URL index status & "why not indexed" | ✅ URL Inspection — **but 2,000/day, 600/min per property** | cache + quota-aware crawler (§7) |
| **Bulk "Page indexing" report** (all URLs + reasons) | ❌ **No bulk export exists** | reconstruct URL-by-URL from sitemaps + analytics, cached, bucketed (§7) |
| **Removals** (incl. autogenerate) | ❌ **UI-only, no API** | detect candidates → deep-link to the property's Removals UI |
| Manual actions / Security issues | ❌ no API | flag as "check manually" → deep-link |
| Links report | ❌ no API | partial proxy from analytics (top linked pages by referral patterns) |
| **Core Web Vitals / page speed** | ❌ not in GSC API | ✅ **PageSpeed Insights API + CrUX API** (separate, free) (§10) |
| Request indexing | ⚠️ Indexing API is officially **JobPosting/BroadcastEvent only**, 200/day | optional, gated, with a loud caveat; never silently abuse it for general pages |
| On-page content/meta/OG/structured-data analysis | ❌ not GSC at all | **fetch the live page ourselves** (`audit_page`, §9) |

**Consequence:** the core engineering primitive is a **local cache + a quota-aware, resumable crawler** (§7). "Show me all my pages and why they aren't indexed" is not one call — it is many URL-Inspection calls spread over days within the 2k/day budget, cached, and bucketed. That cache is the "document."

---

## 3. Architecture overview

```
                         ┌──────────────────────────────────────────────┐
   LLM client            │                MCP server (stdio)            │
  (Claude/Cursor) ─────► │  tools/  ── analytics · inspection · audit   │
                         │            speed · coverage · scores · sites │
                         │  gsc.ts  ── GSC API client (4 services)      │
                         │  speed.ts── PSI + CrUX clients               │
                         │  audit.ts── fetch + parse live HTML          │
                         │  cache/  ── per-site cache + quota ledger    │
                         │  report.ts ─ generates report.{json,md,html} │
                         └───────────────┬──────────────────────────────┘
                                         │ reads/writes
                          ~/.searchlight/sites/<hash>/report.json  ◄── single source of truth
                                         │
            ┌────────────────────────────┼───────────────────────────────┐
            ▼                            ▼                                ▼
   gsc-seo skill (judgment)     Vite dashboard (humans)        MCP Apps widgets (in-chat)
   delegates → ai-seo,          list/switch/act per site       site picker, coverage chart
   seo-content-writer
```

Data flows **one way into the report** and **everything reads the report**. Tools, the skill, the dashboard, and the widgets all consume the same `report.json` so they never disagree.

---

## 4. Tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (ES2022, Node16 module resolution) | `.js` extensions on relative imports |
| Runtime | Node >= 18 | global `fetch` available; shebang entry; `npx`-runnable |
| MCP | `@modelcontextprotocol/sdk` (latest 1.x), `McpServer` + `registerTool` | stdio transport |
| MCP UI (later) | **MCP Apps** UI resources (`mcp-ui` conventions) | in-client widgets; prebuilt HTML/JS |
| Google API | `googleapis` (latest), `google.searchconsole({ version: "v1" })` | brings in `google-auth-library` |
| Page speed | PageSpeed Insights REST API + CrUX API | plain `fetch` + API key; no OAuth |
| HTML parsing | `cheerio` | parse audited pages; extract meta/OG/JSON-LD/headings/links/alt |
| Schema | `zod` | tool input shapes |
| Browser open | `open` | best-effort; always print the URL too |
| Dashboard | **Vite + React** (build-time only) | ships as prebuilt static assets in `dist/dashboard/`; served by a tiny static server. **Not Next.js** — no SSR/SEO need for a local single-user app; lighter bundle, faster iteration |
| Build | `tsc` (+ `vite build` for dashboard) | output to `dist/`, `chmod +x dist/index.js` |

> **Keep the runtime install lean.** Vite/React are **devDependencies**; the dashboard ships prebuilt. `cheerio` and the Google libs are the only meaningful runtime adds over v1. Users `npx`-running the server must not pull a dashboard build toolchain.

Install Google/MCP libs with `@latest` so version ranges are written correctly.

---

## 5. Authentication and configuration

### 5.1 Model: two-tier OAuth client (GSC)

Two ways to get an OAuth client, chosen for lowest friction (full detail in §5.6):

- **Tier 1 — hosted, verified client (default once verified):** a maintainer-owned Desktop OAuth client embedded in the package. The user sets **no env vars** and just signs in — no Google Cloud project. Feasible because `webmasters.readonly` is a *sensitive* (not *restricted*) scope, so verification needs consent-screen review + a demo video, **not** the security assessment Gmail/Drive require.
- **Tier 0 — bring-your-own (fallback / power users / pre-verification):** the user creates their own Google Cloud OAuth client; the server uses it. Needed until Tier 1 is verified, or for users who want their own quota isolation.

Tier 0 one-time setup (document with screenshots / a short recording):
1. Create or pick a Google Cloud project.
2. Enable the **Google Search Console API** (and, for §10, the **PageSpeed Insights API**).
3. Configure the OAuth consent screen as **External**; add yourself as a **test user** (test users bypass verification).
4. Create an **OAuth client ID** of type **Desktop app**.
5. Either copy client ID + secret into env vars, or download `client_secret.json` and point an env var at it.
6. (For §10) create an **API key** for PageSpeed Insights / CrUX.

### 5.2 Runtime login: loopback flow

Login is an interactive CLI subcommand, not part of the MCP server:
1. `searchlight login` starts a throwaway HTTP server on `127.0.0.1:<random-port>`.
2. Build an auth URL with `access_type=offline`, `prompt=consent`, redirect to `http://127.0.0.1:<port>/callback`, and the active scope.
3. Open the browser (print the URL as fallback).
4. Capture `code` on the callback, exchange for tokens, write to disk, show a success page, close the server.
5. Warn loudly if no `refresh_token` came back (usually the app already had access — revoke at myaccount.google.com/permissions and retry).

### 5.3 Token persistence and refresh

- Store tokens at `~/.searchlight/token.json` (override with `SEARCHLIGHT_MCP_HOME`), mode `0600`.
- On server start: load token, set credentials, subscribe to the client's `tokens` event to persist refreshed access tokens.
- **Merge on save**: refresh responses omit `refresh_token`; always merge new over stored to avoid losing it.

### 5.4 Scopes

- Default: `https://www.googleapis.com/auth/webmasters.readonly`.
- If `SEARCHLIGHT_ENABLE_WRITE` is truthy: `https://www.googleapis.com/auth/webmasters` (read + write), and write tools register.
- Changing scope requires a fresh `searchlight login` (the stored token carries the old scope).
- PSI/CrUX use an **API key**, not OAuth — no scope impact.

### 5.5 Config inputs (precedence) and the property registry

GSC OAuth (in order):
1. `SEARCHLIGHT_OAUTH_CLIENT_ID` + `SEARCHLIGHT_OAUTH_CLIENT_SECRET`
2. `SEARCHLIGHT_OAUTH_CREDENTIALS` = path to `client_secret.json` (accept both `installed` and `web` blocks)
3. Otherwise: a clear error naming the exact env vars.

Other config:
- `SEARCHLIGHT_PAGESPEED_API_KEY` — enables §10 tools; if absent, those tools return a clean "set this key" message.
- `SEARCHLIGHT_DEFAULT_SITE` — optional default/active property (see §11).
- `SEARCHLIGHT_MCP_HOME` — override `~/.searchlight`.

**Property registry** — `~/.searchlight/config.json`:
```json
{
  "defaultSite": "sc-domain:example.com",
  "sites": [
    { "alias": "blog",  "siteUrl": "sc-domain:example.com" },
    { "alias": "shop",  "siteUrl": "https://shop.example.com/" }
  ]
}
```
Aliases let users (and the skill) say "audit the blog" instead of pasting a property URL. Managed via CLI (`searchlight sites …`) and tools (§13).

### 5.6 Onboarding tiers (make first-run effortless)

The biggest friction in the whole product is Google auth. We attack it on three fronts so the common path is **install → click sign-in → done**, with bring-your-own as a power-user fallback. (A *hosted OAuth client* is just a shared app registration — tokens and the server still run entirely on the user's machine, so §1's local/single-tenant promise holds.)

- **Tier 1 — zero-config (target / default once verified).** Ship the maintainer-owned, Google-**verified** Desktop client embedded in the package. The user sets **no env vars at all** and just signs in. Desktop-type client secrets are not treated as confidential by Google's installed-app flow, so embedding is acceptable; use PKCE.
- **Tier 0 — bring-your-own (works day one; pre-verification; isolation).** The §5.1 flow. `searchlight setup` opens each Google Cloud page in order and says exactly what to paste.
- **In-conversation login (no terminal).** The **`auth_login`** tool starts the loopback flow from inside the chat — the user says "log me into Search Console," the browser opens, the token is captured, done. The CLI `searchlight login` stays for terminal users. Unauthenticated tool calls return a one-tap next step (with the URL), never a stack trace.
- **Self-driving first run.** `auth_status` returns a `setupState` (`needs_oauth_client | needs_login | needs_pagespeed_key | ready`) and a human `nextStep`; the `gsc-seo` skill (§14) reads it and walks a non-technical user through whatever's missing — so "tell Claude to set it up for me" works.

**Precedence** (extends §5.5): explicit `SEARCHLIGHT_OAUTH_*` / `SEARCHLIGHT_OAUTH_CREDENTIALS` → bundled Tier-1 client → guided setup. The PageSpeed key stays optional and degrades gracefully; it never blocks onboarding.

---

## 6. The Site SEO Report (the "document")

One artifact, generated from the cache, in three renderings. **This is the answer to "pass the data to Claude in the right format."**

### 6.1 `report.json` — the structured digest (for tools & Claude)

```jsonc
{
  "siteUrl": "sc-domain:example.com",
  "alias": "blog",
  "generatedAt": "2026-06-23T00:00:00Z",
  "cache": { "coverageFreshness": "2026-06-21", "quotaUsedToday": 1840, "quotaPerDay": 2000 },
  "scores": {
    "seo":  { "value": 78, "grade": "B",  "topGaps": ["12 pages missing meta description", "sitemap stale"] },
    "eeat": { "value": 64, "grade": "C",  "topGaps": ["no author bylines on 40 posts", "no last-updated dates"] },
    "geo":  { "value": 52, "grade": "C-", "topGaps": ["answers not front-loaded", "no FAQ/HowTo schema"] }
  },
  "coverage": {
    "totals": { "indexed": 420, "notIndexed": 138, "discovered": 884 },
    "buckets": [
      { "state": "Crawled - currently not indexed",   "count": 61, "sampleUrls": ["…", "…"] },
      { "state": "Discovered - currently not indexed", "count": 52, "sampleUrls": ["…"] },
      { "state": "Page with redirect",                 "count": 14, "sampleUrls": ["…"] },
      { "state": "Blocked by robots.txt",              "count": 6,  "sampleUrls": ["…"] }
    ],
    "sitemapGap": { "submitted": 540, "indexed": 420, "missingFromSitemap": 31 }
  },
  "opportunities": [ /* top N from find_opportunities, ranked, with reasons[] */ ],
  "pageIssues":   [ /* top N audit findings across the site, deduped, by severity */ ],
  "speed": { "mobile": { "lcp": 3.4, "inp": 210, "cls": 0.04, "lighthouse": 71 } },
  "deepLinks": { "removals": "https://search.google.com/search-console/removals?resource_id=…",
                 "manualActions": "…", "securityIssues": "…" }
}
```

### 6.2 `report.md` — narrative for humans (and the skill's first read)
A prioritized, plain-English summary: scores up top, then "fix these first," then coverage buckets, then per-page issues. No raw tables of thousands of rows.

### 6.3 `report.html` — single self-contained file (zero runtime)
Generated alongside `.json/.md`. Open it in a browser, screenshot it, share it. This is the lightest dashboard and the easiest build-in-public asset. (The Vite app in §15 is the interactive version.)

### 6.4 Data-format-for-Claude principles (enforced everywhere)
- **Aggregate server-side.** Tools return digests, not raw rows.
- **Cap samples.** Buckets carry ≤10 example URLs, not the full list; Claude drills down with `coverage_report(state, startRow)`.
- **Round numbers.** CTR 4 dp, position 1 dp.
- **Pre-rank.** Opportunities and issues arrive sorted by score/severity so Claude reads the top, not the haystack.
- **Drill-down on demand.** Big sets are paginated tools, never one mega-payload.

---

## 7. The local cache and quota-aware crawler

### 7.1 Cache layout
```
~/.searchlight/
  token.json
  config.json
  sites/
    <sha1(siteUrl)>/
      meta.json        # siteUrl, alias, lastCoverageRefresh, lastReportBuild
      quota.json       # { "2026-06-23": 1840 }  per-day URL-inspection counter
      coverage.json    # url → { verdict, coverageState, robotsTxtState, indexingState,
                       #         googleCanonical, userCanonical, lastCrawlTime, crawledAs,
                       #         sitemapMember, inspectedAt }
      audits/<sha1(url)>.json   # per-page audit results (§9)
      speed.json       # PSI/CrUX results (§10)
      report.json | report.md | report.html
```

### 7.2 Coverage reconstruction (the "Page indexing" report the API won't give us)
1. **Collect candidate URLs**: union of (a) every `<loc>` in submitted sitemaps, (b) the `page` dimension from analytics (catches indexed URLs missing from sitemaps).
2. **Inspect within budget**: for URLs not in cache or older than a staleness window, call URL Inspection, throttled to stay under **2,000/day, 600/min** per property. Track in `quota.json`. **Resumable** across days.
3. **Bucket** by `coverageState` (mirrors the GSC UI), mapping the user's mental model:

| User's wording | Buckets |
| --- | --- |
| "redirected or blocked due to other issues" | Page with redirect · Blocked by robots.txt · Blocked due to 4xx · Excluded by noindex |
| "crawled pages not indexed" | **Crawled – currently not indexed** |
| "pages not currently indexed" | **Discovered – currently not indexed** |
| "sitemaps not ensuring indexing" | sitemap `submitted` vs `indexed` gap + URLs missing from sitemap |

4. **Write to `report.json`** with counts + capped samples + cache freshness + remaining quota.

`refresh_coverage` advances step 2 and reports progress ("1,840/2,000 used today, ~3 days to full coverage at this rate").

---

## 8. Scoring engine (SEO / E‑E‑A‑T / GEO)

Three heuristic scores plus a unified "fix these first" list. **Honesty note for build-in-public:** Google states E‑E‑A‑T is *not a direct ranking factor*, so we label it "quality signals aligned with E‑E‑A‑T," not a Google number.

| Score | Signals (computed from cache + audits + speed) |
| --- | --- |
| **SEO** | indexability & coverage health; title/meta presence & quality; canonical correctness; sitemap freshness; broken/redirect ratio; mobile usability; Core Web Vitals (§10) |
| **E‑E‑A‑T (EEO)** | author bylines / `author` schema; outbound citations to trusted sources; last-updated / freshness dates; about/contact presence; original vs thin content signals |
| **GEO** | front-loaded direct answers; FAQ/HowTo/QAPage schema; factual density & extractability; clear headings as answerable questions; quotable structure. **Delegates to the `ai-seo` skill** for the deep analysis |

Each score returns `{ value, grade, topGaps[], whatToFix[] }` where `whatToFix` items are concrete and grounded in Google's SEO Starter Guide checklist (titles, meta descriptions, descriptive URLs, canonicalization, alt text, internal links, "avoid intrusive interstitials/distractions"). Also surfaces **what's missing entirely** ("no structured data found", "no sitemap submitted", "no page-speed data — set `SEARCHLIGHT_PAGESPEED_API_KEY`").

---

## 9. On-page audit (`audit_page`) — OG Fixer generalized

Fetch the live URL, parse the HTML, and report **fixable** issues with suggested edits. This closes the "GSC won't tell me *how*" gap.

Checks:
- **Title** — present, unique, length, not keyword-stuffed.
- **Meta description** — present, unique, length.
- **Canonical** — present; self vs cross; **cross-checked against GSC's reported `googleCanonical`** from the inspection cache.
- **Headings** — exactly one H1, logical order.
- **Open Graph + Twitter cards** (the OG Fixer core) — `og:title/description/image/url/type`, `twitter:card/title/description/image`; image presence + dimensions; render a **per-platform preview** (Google, X/Twitter, Facebook, LinkedIn, Slack, Discord) and a **completeness score**.
- **Structured data** — JSON-LD present & parseable; which rich-result types the page is eligible for.
- **Images** — missing/empty `alt`.
- **Internal links** — descriptive anchor text; orphan/over-link flags.
- **Distractions** — intrusive interstitials / heavy ad density (Google's explicit warning).

Each finding:
```jsonc
{ "id": "meta-description-missing", "category": "meta", "severity": "warning",
  "title": "No meta description", "evidence": "<head> has no <meta name=description>",
  "suggestedEdit": { "before": null, "after": "<meta name=\"description\" content=\"…\">" },
  "doc": "https://developers.google.com/search/docs/appearance/snippet" }
```

Results cache to `audits/<hash>.json` and feed `report.json.pageIssues`.

---

## 10. Page speed (PageSpeed Insights + CrUX)

Addresses "I haven't been watching page speed." Uses the **PageSpeed Insights API** (Lighthouse lab scores) and **CrUX API** (real-user field Core Web Vitals). Needs `SEARCHLIGHT_PAGESPEED_API_KEY`; degrades cleanly without it.

- **`page_speed`** — `{ url, strategy?=mobile|desktop }`. Returns Lighthouse performance score + lab metrics, plus CrUX field **LCP / INP / CLS** with pass/needs-work/poor verdicts. Feeds `report.json.speed` and the SEO score.

---

## 11. Multi-site: list / switch / act — switchable from inside the MCP

Switching the working property must happen **through the MCP itself** — the user tells Claude "switch to the blog" and every later call re-targets — *not* only from the dashboard. Because this is a **stdio** server, the process is long-lived for the connection, so it can hold session state safely. We keep our **own** active-site state (not protocol session state) so switching survives the protocol's drift toward statelessness (§20).

**Two-tier site context, both set via tools:**
1. **Session active site** — an in-memory property for this connection, set by **`use_site`**. "Switch to the blog" → every later call defaults to it. No dashboard, no restart.
2. **Persisted default** — `config.json`, set by **`set_default_site`**, survives restarts and applies when no session active site is set.

**Resolution order** for any per-site tool: explicit `siteUrl`/`alias` arg → session active site → persisted default → a clean "which site?" error listing the registry. `siteUrl` is therefore **optional** on every per-site tool.

- **List** — `list_sites` merges live GSC properties with registry aliases & permission levels, and marks which is active/default.
- **Switch** — `use_site` (session) and `set_default_site` (persisted); `get_active_site` reports the current property and how it was resolved. The dashboard switcher and MCP App picker mirror this, but none of them are required — switching is fully doable in-conversation.
- **Act per site** — every tool re-targets the resolved property: prioritized fix list, `refresh_coverage`, `audit_page`, sitemap submit (write flag), and `gsc_deep_link` for that property's Removals / Manual-actions UI.
- **Portfolio** — **`account_overview`** aggregates scores, coverage totals, and top opportunities across all properties so a multi-site owner sees everything at once.

---

## 12. CLI surface

`searchlight` dispatches on `argv[2]`:

| Command | Behavior |
| --- | --- |
| `login` | Interactive browser login (§5.2) |
| `setup` | Guided first-run: detects what's missing (OAuth client, login, PageSpeed key) and walks through it, opening the right Google Cloud pages for Tier 0 (§5.6) |
| `logout` | Delete the stored token |
| `status` | Authenticated? token path, active scope, default site |
| `sites` | `list` / `add <alias> <siteUrl>` / `remove <alias>` / `default <alias>` (registry, §11) |
| `refresh <site>` | Advance the coverage crawl within today's quota; rebuild the report |
| `report <site>` | Build & print path to `report.{json,md,html}` |
| `dashboard` | Serve the prebuilt Vite dashboard on `127.0.0.1:<port>` and open it |
| `serve` (default) | Start the MCP server over stdio |
| `help` / `-h` / `--help` | Usage |

**Critical**: the MCP stdio channel is stdout. All human-facing logging goes to **stderr** (`console.error`). Never write logs to stdout in `serve` mode.

---

## 13. Tool catalog

All tools return `content: [{ type: "text", text }]`. On error, same shape with `isError: true` and a message prefixed `Error:`. Data is compact, pre-aggregated JSON (§6.4). `siteUrl` accepts a property identifier **or** a registry alias, **or is omitted** to fall back to the session active site / persisted default (§11 resolution order). URL-prefix properties end with `/`; domain properties use `sc-domain:…`. GSC data lags ~2 days; default windows end "2 days ago."

### Diagnostics
- **`auth_status`** — `{ authenticated, scope, writeEnabled, tokenPath, activeSite, defaultSite, pageSpeedKeySet, setupState, nextStep, hint }`. `setupState` ∈ `needs_oauth_client | needs_login | needs_pagespeed_key | ready` — drives the self-driving onboarding in §5.6.
- **`auth_login`** — no input. Runs the loopback login **in-conversation**: opens the browser, captures the token, persists it, returns success. Lets the user say "log me into Search Console" without touching a terminal.

### Sites & multi-site (§11)
- **`list_sites`** — registry-merged property list with permission levels and aliases; flags the active and default sites.
- **`use_site`** — `{ site }`. Sets the **session** active property (in-memory, this connection). The primary "switch context" tool — no dashboard needed.
- **`get_active_site`** — no input. Returns the resolved property and whether it came from arg / session / default.
- **`set_default_site`** — `{ site }`. Persists the default property to `config.json` (survives restarts).
- **`account_overview`** — no input. Cross-property scores, coverage totals, top opportunities.
- **`gsc_deep_link`** — `{ siteUrl?, report: removals|manualActions|securityIssues|pageIndexing }`. Returns the exact GSC UI URL (for the API-less surfaces in §2).

### Search analytics (core)
- **`query_search_analytics`** — the single search-analytics tool (`top_queries`/`top_pages` are now its `preset`). Inputs: `siteUrl` (optional — §11 resolution); `preset` (`top_queries|top_pages`, sets dimensions for you); `days` (convenience lookback, ignored if `startDate` given); `startDate`/`endDate` (default last 28d ending 2d ago); `dimensions` (subset of `query|page|country|device|searchAppearance|date`); `type` (`web|image|video|news|discover|googleNews`); `dimensionFilters` (`[{ dimension, operator?, expression }]`, operators `equals|notEquals|contains|notContains|includingRegex|excludingRegex`, AND-combined); `rowLimit` (1–25000, default 1000); `startRow`; `aggregationType` (`auto|byPage|byProperty`); `dataState` (`final|all`). Returns `{ rowCount, rows }` flattened.

### Insight tools
- **`find_opportunities`** — `{ siteUrl, dimension?=query, days?=90, minImpressions?=50, limit?=25 }`. Flags **striking distance** (avg position 5–20, score `impressions*(21-position)`) and **low CTR on page one** (`position<=10 && ctr<0.02 && impressions>=2*minImpressions`, `+impressions*5`). Returns ranked rows with `opportunityScore`, `reasons[]`, and a "what to do" note.
- **`compare_periods`** — `{ siteUrl, dimension?=query, days?=28, limit?=10 }`. Last N vs preceding N days: `{ windows, totals, gainers[], losers[] }`. Two queries in parallel.

### Coverage / indexing (§7)
- **`coverage_report`** — `{ siteUrl, state?, limit?=50, startRow?=0 }`. Bucketed summary from cache + freshness + quota status. Pass `state` (an exact `coverageState`) to drill into one bucket and list its URLs, paginated (absorbs the old `get_pages_in_bucket`).
- **`refresh_coverage`** — `{ siteUrl, maxUrls?, allSites? }`. Advance the crawl within today's quota; report progress. `allSites: true` refreshes every accessible property in one call (absorbs the old `refresh_all_coverage`).
- **`inspect_url`** — `{ siteUrl, inspectionUrl, languageCode?=en-US }`. Single-URL inspect (also populates cache). Returns `inspectionResult`.

### Site crawl & audit (§9) — direct-fetch, no Google scope or quota
- **`crawl_site`** — `{ siteUrl, maxPages?=150, reset? }`. Direct-fetch crawl of the live site: seeds from sitemap + robots.txt + homepage, follows internal links, capturing each URL's status, full redirect chain, `X-Robots-Tag`, canonical/meta-robots/title, hreflang, schema validity, and the internal-link graph. Bounded + resumable; robots-obeying. Run before `site_audit`.
- **`site_audit`** — `{ siteUrl }`. Turns the crawl into a triaged, site-wide report: status inventory (4xx/5xx), redirect chains/loops + 301-vs-302 guidance, noindex, canonical health, dup/param clustering, schema validity, hreflang reciprocity, and orphan detection — ranked by severity × affected-page count.
- **`export_report`** — `{ siteUrl }`. Formats `site_audit` into one copy-paste Markdown report (grade, metrics, findings with fix + example URLs).

### On-page audit (§9)
- **`audit_page`** — `{ url }`. Full on-page audit with findings + suggested edits + per-category scores + platform previews.

### Page speed (§10)
- **`page_speed`** — `{ url, strategy?=mobile }`. PSI Lighthouse + CrUX field CWV.

### Diagnosis, scores & baselines (§6, §8)
- **`diagnose_site`** — `{ siteUrl }`. Plain-English triaged health (score + grade; fix-now / worth-improving / looks-scary-but-fine / working), fusing cached coverage, live sitemap/robots checks, 28-day traffic, AI-crawler/llms.txt visibility, and — when a crawl exists — cross-source reconciliation (sitemap × robots × crawl × GSC).
- **`snapshot_baseline`** — `{ siteUrl }`. Freeze today's diagnosis as a dated snapshot so a later run can prove before→after. Same-day re-run overwrites.
- **`list_snapshots`** — `{ siteUrl }`. Dates (oldest→newest) with a saved snapshot.
- **`progress_report`** — `{ siteUrl, from?, to? }`. Diff two snapshots: health/grade movement, indexed/traffic deltas, and issues RESOLVED / NEW / PERSIST.

### Google Analytics 4 (§22)
- **`ga_list_properties`** — no input. GA4 properties you can access, with website URLs.
- **`ga_measurement_id`** — `{ siteUrl?, propertyId? }`. The gtag Measurement ID(s) (`G-XXXX`) of an existing property (by id or auto-matched from the site) + a ready-to-paste snippet.
- **`ga_report`** — `{ propertyId, preset?, metrics?, dimensions?, orderByMetricDesc?, days?, limit? }`. GA4 reporting; preset `traffic` (by channel) or `top_pages` (by page), or your own metrics/dimensions.

### Sitemaps (read)
- **`list_sitemaps`** — `{ siteUrl, feedpath? }`. Array with status + error/warning counts; pass `feedpath` (a full sitemap URL) for the detailed status of just that one (absorbs the old `get_sitemap`).

### Sitemaps (write — only when `SEARCHLIGHT_ENABLE_WRITE`)
- **`submit_sitemap`** — `{ siteUrl, feedpath }`.
- **`delete_sitemap`** — `{ siteUrl, feedpath }`.

---

## 14. The `gsc-seo` skill (judgment layer)

A skill (`skill/SKILL.md`) so non-technical users get the *workflow*, not raw tools. It owns the loop and delegates:

- **Workflows**: "audit my site," "why isn't this page indexed?", "what should I fix first?", "did last month improve?", "make my pages AI-citable."
- **Method**: read `report.md` first → drill via tools only where it decides to act → return a ranked, plain-English action list grounded in Google's Starter Guide → for content/title/meta rewrites delegate to **`seo-content-writer`** → for AI-citation/GEO work delegate to **`ai-seo`**.
- **Self-driving onboarding**: on first use it reads `auth_status.setupState` and walks a non-technical user through whatever's missing — calling `auth_login` to sign in (no terminal) or guiding Tier-0 Cloud setup — so "set it up for me" actually works (§5.6).
- **Multi-site aware**: resolves the active site once per session (§11), confirms before any write action, and hands deep-links for API-less surfaces (removals, manual actions).
- **Distraction discipline**: surfaces the few highest-impact fixes, not every signal — matching the user's "avoid distracting details."

Distributed in the npm package so installing the server makes the skill available.

---

## 15. Dashboard + widgets + static report

Three rendering paths, layered (do not use Next.js — §4):

| Path | What | Phase |
| --- | --- | --- |
| **Static `report.html`** | single self-contained file from the report generator (§6.3) | first (nearly free) |
| **MCP Apps widgets** | in-client interactive components (site picker, coverage chart, opportunity list) rendered inside Claude via MCP UI resources | mid |
| **Vite SPA dashboard** | `searchlight dashboard` → local `127.0.0.1` app reading `report.json`; **list sites, switch, drill into buckets/audits, trigger `refresh_coverage`** | the "real" dashboard |

The Vite app is **prebuilt** into `dist/dashboard/` and served by a tiny static server — no build toolchain at runtime. It reads the same per-site `report.json` the tools write, so it never disagrees with what Claude sees.

---

## 16. Project layout

```
searchlight/
  package.json          # bin: { "searchlight": "dist/index.js" }, type: module, files incl. dist/dashboard
  tsconfig.json         # ES2022, Node16
  .env.example          # every env var (OAuth, SEARCHLIGHT_PAGESPEED_API_KEY, SEARCHLIGHT_DEFAULT_SITE, …)
  .gitignore            # node_modules, dist, token.json, client_secret*.json, .env, ~/.searchlight
  README.md  LICENSE    # MIT
  src/
    index.ts            # shebang + CLI dispatch (§12)
    auth.ts             # credentials, loopback login, token store, getAuthClient (§5)
    config.ts           # property registry, defaults, key resolution (§5.5)
    gsc.ts              # cached searchconsole client + row/date helpers
    speed.ts            # PSI + CrUX clients (§10)
    audit.ts            # fetch + cheerio parse + findings (§9)
    cache.ts            # per-site cache + quota ledger (§7)
    coverage.ts         # candidate collection, crawl, bucketing (§7)
    score.ts            # SEO / E-E-A-T / GEO (§8)
    report.ts           # generate report.{json,md,html} (§6)
    server.ts           # buildServer(): registers all tools; startServer()
    tools/              # one module per tool group
  skill/
    SKILL.md            # the gsc-seo skill (§14)
  dashboard/            # Vite + React source (built to dist/dashboard) (§15)
```

`package.json`: `"type": "module"`, `"bin"`, `"files": ["dist","skill","README.md",".env.example"]`, scripts `build` (`tsc && vite build --outDir dist/dashboard && chmod +x dist/index.js`), `bundle` (`mcpb pack` → `searchlight.mcpb` for one-click Desktop install, §17.1), `login`, `start`, `dashboard`, `prepublishOnly`. Keep the `#!/usr/bin/env node` shebang first in `src/index.ts`.

---

## 17. Distribution and client config

Target usage is `npx`. Claude Desktop / generic MCP client:
```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "@ajmalaksar/searchlight", "serve"],
      "env": {
        "SEARCHLIGHT_OAUTH_CLIENT_ID": "...",
        "SEARCHLIGHT_OAUTH_CLIENT_SECRET": "...",
        "SEARCHLIGHT_PAGESPEED_API_KEY": "...",
        "SEARCHLIGHT_DEFAULT_SITE": "sc-domain:example.com"
      }
    }
  }
}
```
That block is the **Tier 0 (bring-your-own)** example. Then either log in once from a terminal, or just tell Claude *"log me into Search Console"* (the `auth_login` tool, §5.6):
```
npx -y @ajmalaksar/searchlight login
```
Confirm the final npm name/scope before publishing (`@ajmalaksar/searchlight` is a placeholder).

### 17.1 Low-friction install paths (the intended default experience)

- **Zero-config (Tier 1, once the hosted client is verified):** the same config block with an **empty `env`** — no OAuth vars, no PageSpeed key required. Install, then say "log me in."
- **One-click for Claude Desktop (`.mcpb`):** ship an **MCP Bundle** so non-technical users **double-click to install** — no JSON, no terminal. `npm run build` also packs `searchlight.mcpb`.
- **One-line for Claude Code:** `claude mcp add gsc -- npx -y @ajmalaksar/searchlight serve`, then tell Claude to log in.
- **"Tell Claude to install it":** the user pastes — *"Install the searchlight MCP server and sign me into Google Search Console."* Claude Code runs `claude mcp add`, calls `auth_login`, then `list_sites`. The onboarding skill (§14) handles anything missing.

---

## 18. Testing plan

1. **Build**: `npm run build` compiles clean with `strict: true`; dashboard builds to `dist/dashboard`.
2. **Auth happy path**: `login` opens browser, callback succeeds, `token.json` has a `refresh_token`.
3. **Refresh**: delete the access token (keep refresh), start server, confirm a call works and the file is rewritten.
4. **Tool smoke** (MCP Inspector): list tools; call `auth_status`, `list_sites`, `query_search_analytics`, `find_opportunities`, `audit_page`, `page_speed`, `coverage_report`, `crawl_site`, `site_audit`, `diagnose_site` against a real property.
5. **Coverage/quota**: `refresh_coverage` respects 2k/day, persists `quota.json`, resumes next run, buckets correctly.
6. **Audit correctness**: `audit_page` on a page with a missing meta/OG image reports it with a suggested edit; previews render.
7. **Multi-site**: alias resolution, `set_default_site`, `account_overview` aggregates.
8. **Read-only safety**: `submit_sitemap`/`delete_sitemap` absent unless `SEARCHLIGHT_ENABLE_WRITE`; no tool ever mutates the live site otherwise.
9. **Error surface**: unauthenticated → "run `searchlight login`"; bad `siteUrl` → API error text; missing PSI key → "set `SEARCHLIGHT_PAGESPEED_API_KEY`".
10. **stdout cleanliness**: only JSON-RPC on stdout in `serve` mode.
11. **Dashboard**: `searchlight dashboard` serves and renders the report; switching sites re-renders.
12. **Onboarding**: a fresh machine with no env vars reaches first data via `auth_login` (in-conversation, no terminal); `.mcpb` double-click installs in Claude Desktop; `auth_status.setupState` correctly reports each missing piece.

---

## 19. Roadmap (phased, build-in-public)

Each phase is a standalone, demoable artifact.

1. **v1 MCP** — analytics, sitemaps, inspection, `find_opportunities`, `compare_periods`, auth (+ in-conversation `auth_login`), `list_sites`, `.mcpb` / `claude mcp add` install. *(Largely the existing scaffold.)* Demo: install + "log me in" + LLM doing SEO triage in plain English.
2. **Cache + coverage reconstruction + `diagnose_site`/`site_audit`** — the "document" and the indexing buckets the user asked for. Demo: "here's every page Google won't index, and why."
3. **`audit_page` (full) + `page_speed`** — the how-to-fix gap + Core Web Vitals. Demo: OG/preview fixes + LCP/INP/CLS.
4. **Scores + `gsc-seo` skill** — SEO/E‑E‑A‑T/GEO, delegating to `ai-seo`/`seo-content-writer`. Demo: one-command site audit with a ranked fix list.
5. **Dashboard** — static `report.html` → MCP Apps widgets → Vite SPA with list/switch/act.
6. **Onboarding + multi-site + polish** — `setup` wizard, self-driving onboarding, `account_overview`, deep-links, docs, npm publish. **Pursue Google verification of the Tier-1 hosted client** to flip the default to zero-config sign-in; ship Tier-0 bring-your-own until then.

---

## 20. Edge cases and gotchas

- **No refresh token**: warn + instructions (revoke + re-consent with `prompt=consent`).
- **Domain vs URL-prefix properties**: both valid; never normalize or strip the trailing slash.
- **URL Inspection quota (2k/day, 600/min)**: the binding constraint for coverage; crawler must throttle, persist a daily ledger, and resume. Communicate progress, never silently truncate.
- **No bulk coverage / removals / manual-actions / links / CWV in the API**: reconstruct (coverage), substitute (CWV via PSI/CrUX), or deep-link (removals, manual actions). Never imply we have data we don't.
- **Indexing API**: officially JobPosting/BroadcastEvent only, 200/day. If ever offered, gate it behind an explicit flag and a loud caveat; do not use it for general pages by default.
- **Data freshness**: expose `dataState: "all"`; default to finalized.
- **Page fetch failures** (`audit_page`): timeouts, JS-rendered pages, bot blocks → return a clear partial result, not a crash. Note when a page is JS-heavy and the static fetch may miss content.
- **Token discipline**: insight/coverage tools may analyze up to 25k rows locally but must return digests; pagination via `startRow`/`coverage_report(state, …)`.
- **MCP going stateless**: the protocol is drifting away from server-held sessions. Keep the active site as our *own* in-process variable with a persisted `config.json` fallback, so `use_site` keeps working regardless of protocol-level session semantics. If a future HTTP/multi-session transport is added, key the active site by session id rather than a module global.
- **Dashboard weight**: keep Vite/React as devDeps; ship prebuilt; never pull a build toolchain at `npx` runtime.
- **Scope change**: switching `SEARCHLIGHT_ENABLE_WRITE` requires re-login.
- **Unverified-app screen (pre-verification)**: until the Tier-1 hosted client is Google-verified, sign-in shows an "unverified app" warning and is capped at ~100 users. Document the "Advanced → continue" step; keep Tier-0 bring-your-own as the default until verification lands, then flip it.

---

## 21. Build-in-public angle

This ships under a personal brand, so each phase is designed to be a post:
- **`find_opportunities`** — "you're at position 7, here's how to reach page one," screen-recorded.
- **Coverage reconstruction** — "the GSC API won't give you the indexing report in bulk; here's how I rebuilt it within the 2k/day quota." A genuinely useful technical explainer.
- **`audit_page`** — before/after OG previews across six platforms; the "GSC tells you *what*, this tells you *how*" framing.
- **The loopback OAuth write-up** — evergreen explainer + portfolio piece.
- **SEO/E‑E‑A‑T/GEO scores on a live site** — a screenshot-friendly dashboard, with the honest "E‑E‑A‑T isn't a direct ranking factor" caveat that builds credibility.

---

## 22. Expanded scope (v3): full analytics, pro-grade audit, and auto-fix

The goal widened: **one login connects everything** (Search Console + Analytics + speed), the assessment matches what **professional SEO agencies** deliver, and — because the user runs this in an agent (Claude Code) with their site's repo open — the system can **diagnose *and* fix**. This section captures that; it supersedes any narrower framing above where they conflict.

### 22.1 What pro audits cover — and our coverage
A 2026 agency-grade audit spans six layers. Where searchlight stands:

| Layer | What pros assess | Status |
| --- | --- | --- |
| **Technical** | crawl/index, architecture, internal links, duplicates, structured data, AI-readability | coverage ✅, `diagnose_site` ✅ |
| **On-page** | titles (<60), metas (~155), one H1, keyword placement | `audit_page` ⏳ |
| **Content / E‑E‑A‑T** | first-hand experience, author/date/sources, depth | `audit_page` + scoring ⏳ |
| **Core Web Vitals** | LCP / INP (decisive in 2026) / CLS on top pages | PSI/CrUX ⏳ |
| **Backlinks** | profile + competitor gap | ❌ not in GSC API — 3rd-party/defer |
| **Local** | Google Business Profile + citations | ❌ separate API — future |
| **AI / LLM visibility (GEO)** | schema, extractable answers, citability | `ai-seo` skill ⏳ |

### 22.2 Analytics layer (GA4) — "one login, full analytics"
- Add the **`analytics.readonly`** (sensitive) scope to the bundled OAuth client → users re-consent once; verification then covers two sensitive scopes (still no security assessment). The MCP becomes the single connection hub.
- GA4 **Data API** (`google.analyticsdata`) + **Admin API** (list properties). Tools: traffic by channel (organic vs paid vs direct vs referral), users/sessions/engagement, top landing pages, conversions/events, and a **GSC↔GA join** (search query → on-site behavior).
- **Setup-gap detection:** flag pages missing the GA4 tag (scan page HTML for the `gtag`/GA4 snippet during `audit_page`) → "these pages aren't measured — here's how to add it."

### 22.3 The fix layer — diagnose → map to code → fix
The real differentiator: not just *what's wrong* but *fixed*.
- **MCP diagnoses** (data + why + where). **The agent (Claude) + the `gsc-seo` skill apply fixes** in the user's connected project repo — the MCP itself never edits arbitrary files (security); the agent does, guided by the skill.
- **Framework-aware, not hardcoded:** detect the stack (Next.js, Astro, Nuxt, SvelteKit, plain HTML, CMS export…) and apply idiomatic fixes:
  - broken redirect (e.g. `/blog`) → correct the rule (`next.config`/`vercel.json`/middleware);
  - sitemap 307/missing → generate or fix the sitemap route so it returns 200 with canonical URLs;
  - robots 4xx on a subdomain → add/fix the robots handler;
  - missing canonical → self-referencing canonical in metadata/head;
  - missing GA4 tag → inject the snippet;
  - thin/unindexed content → expand (delegate to `seo-content-writer`).
- **Verify loop:** after each fix, re-run `diagnose_site` / `inspect_url` to confirm. The diagnosis→code mapping is heuristic knowledge in the skill, kept general.
- **Non-code sites** (hosted CMS, no repo): give exact step-by-step instructions + deep links instead of editing.

### 22.4 The ecosystem
`MCP (data + diagnosis + analytics)` → `skill (persona-aware judgment + fix orchestration)` → `UI (MCP Apps widget + dashboard, navigable health view)` → `outcome (measured improvement vs the tracked baseline)`. One login; accessible to zero-experience users; agency-grade depth.

### 22.5 Honest gaps
- **Backlinks**: no GSC API — needs a third party (Ahrefs/Majestic/etc.) or defer; say so.
- **Local/GBP**: separate API; future.
- **Request-indexing / removals**: not general-API; deep-link + instructions.
- **Auto-fix** needs the repo connected; otherwise instructions, not edits.

### 22.6 Roadmap delta
Re-prioritized after Phase 2: **Phase 3** `audit_page` + PSI/CrUX → **Phase 3.5** GA4 analytics layer (+ scope re-consent) → **Phase 4** scores + the **fix skill** (diagnose→code→fix→verify) → **Phase 5** MCP UI + dashboard. Commit/push per slice.

---

## 23. Access tiers and the `/seo-setup` skill (zero-to-configured)

Setting a site up *from scratch* needs more than read access. We tier it so the public app stays easy to verify while power users can opt into full automation.

### 23.1 Access tiers
| Tier | Access | Enables | Verification cost |
| --- | --- | --- | --- |
| **0** | PSI / CrUX **API key** | page speed, Core Web Vitals | none |
| **1 (default)** | `webmasters.readonly` + `analytics.readonly` | diagnose, audit, report (read everything) | low (2 sensitive scopes) |
| **2 (opt-in "setup mode")** | + `webmasters` (write), `siteverification`, `analytics.edit`, `tagmanager.edit.containers` / `manage.accounts` / `publish` | add+verify a GSC site, submit sitemaps, create a GA4 property+stream, create/publish a GTM container | high (many sensitive/edit scopes) |
| **3 (repo)** | Claude Code filesystem — **no Google scope** | inject GA4/GTM snippet, generate sitemap/robots, fix canonical/redirects, add structured data | n/a |

**Flag design (frictionless rule).** A user should make exactly one decision: *look* or *change*. Default is read-only (Tier 1). **`--setup` is the single "change" flag** — it turns on provisioning (Tier 2) **and** Search Console writes (sitemap submit/delete); `writeEnabled()` folds in `setupEnabled()`. The narrower `--write` still exists (write tools without provisioning) for power users, but `--setup` never requires also passing `--write`. Rationale: setup mode already requests the full `webmasters` scope, so the old split produced a setup mode that couldn't finish setup — the blind test (zawaaj.in) hit exactly this. Don't reintroduce a state where the user must reason about flag combinations.

### 23.2 Zero-to-configured flow (a site with nothing set up)
1. **GSC** — `sites.add` + verify ownership via the **Site Verification API** (HTML-file/meta method: token injected into the repo).
2. **GA4** — create a property + web data stream via the **Admin API** (`analytics.edit`) → measurement ID. *Caveat: the API creates properties under an existing Analytics **account**; it cannot create a new account — guide the user for that one step.*
3. **GTM** (optional) — create a container (`tagmanager.edit.containers`) → GTM ID. Or skip GTM and use `gtag` directly.
4. **Repo (Tier 3)** — inject the GA4/GTM snippet, generate sitemap + robots, add canonical, fix redirects, add schema.
5. **Submit** the sitemap to GSC (`webmasters`).
6. **Verify** — re-run `diagnose_site` until green.

### 23.3 The recommended balance — don't over-scope
Most setup is **code (Tier 3) + read scopes (Tier 1) + a couple of guided one-click Google actions** — not full edit-scope automation. So:
- **Public verified app = Tier 1 (read-only).** Easy verification, safe consent.
- **Setup is performed mostly via repo edits + guidance**, with **Tier 2 provisioning as an explicit opt-in** (`SEARCHLIGHT_ENABLE_SETUP`, separate consent / bring-your-own client). E.g. GA4: either create via `analytics.edit` (opt-in) *or* guide the user to create it and paste the measurement ID (no edit scope needed).
- Rationale: every added scope makes verification harder and the consent scarier. Keep the default minimal; gate power behind opt-in.

### 23.4 The `/seo-setup` skill
A skill that runs the flow end-to-end: **detect gaps** (`diagnose_site` + `audit_page` checks for: GSC verified? GA4 tag present? GTM? sitemap reachable+submitted? robots ok? canonical? ) → **provision** what the active tier allows → **fix the repo** (framework-aware) → **submit + verify**. Idempotent; asks before account-level or destructive actions; persona-aware (beginner vs pro). The MCP supplies the data and (in setup mode) the provisioning tools; the skill + agent do the orchestration and code edits.

### 23.5 GCP APIs to enable (per capability)
- **Already needed:** Search Console API, PageSpeed Insights API, Chrome UX Report API.
- **For the GA layer (Tier 1 read):** **Google Analytics Data API** *and* **Google Analytics Admin API** — both must be enabled in the Cloud project, in addition to re-login with `analytics.readonly`, or the `ga_*` tools return "API not enabled".
- **For setup mode (Tier 2):** **Site Verification API** and **Tag Manager API** (GA4 property creation is covered by the Analytics Admin API above).

### 23.6 Verification reality + the guided interview
- **Verification is not fully automatable.** Methods: `FILE`/`META` (URL-prefix only — automatable by injecting into the repo), `ANALYTICS`/`TAG_MANAGER` (if already installed), `DNS_TXT`/`DNS_CNAME` (needs the user's DNS access).
- **Domain properties (`sc-domain:`) can ONLY be verified by DNS.** So for domain properties we cannot auto-verify — we surface the exact TXT record and host-specific steps (e.g. Cloudflare) and let the user paste it. URL-prefix properties can be auto-verified via the repo.
- **The setup skill must ask before it acts.** It runs a confirmed interview, not a silent provisioning: *which site? analytics yes/no? create a new GA4 property or connect an existing one? which Analytics account? GTM or just the gtag snippet? what do you want to track (key events/conversions)? is the code in a repo I can edit, or hosted?* → produces a plan → **confirms** → executes → re-verifies. It never creates accounts/properties or edits code without explicit confirmation, and explains what each step does and why.

## 24. Baseline snapshots and progress reports (provable before→after)

The north star is a tracked **baseline → improvement** loop. `diagnose_site` answers "how healthy is this site *right now*"; snapshots make that longitudinal so we can prove a fix worked rather than just assert it.

- **`snapshot_baseline`** — freezes today's `diagnose_site` output (health score + grade, indexed/not-indexed/inspected counts, 28-day clicks/impressions/top-queries, and the actionable critical+warning finding list) to `~/.searchlight/sites/<hash>/snapshots/<YYYY-MM-DD>.json`. Re-running on the same UTC day overwrites that day (a fresh read of "today"). Capture one **before** changing anything.
- **`list_snapshots`** — the dates available for a property (oldest→newest), so the user can pick two to compare.
- **`progress_report`** — diffs two snapshots (defaults oldest→newest; accepts explicit `from`/`to`). Reports score/grade movement, indexed/traffic deltas, and findings matched by their stable `id` into **resolved** (gone), **new** (appeared), and **persisting** (still present) — plus an honest plain-English headline (including "no measurable change" when nothing moved).

Findings are matched on the same stable ids `diagnose_site` already emits (e.g. `coverage:<state>`, `robots:<host>`, `sitemap:unreadable`), so resolving a real issue shows up as a resolved finding with no per-site special-casing. Read-only and local — registered in all tiers, no extra scopes. Backed by `src/snapshot.ts` (pure capture/diff) + `src/tools/snapshot.ts`.
