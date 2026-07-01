# Security

Searchlight is a local-first MCP server for Google Search Console and Google
Analytics. It runs entirely on your machine, talks only to Google's own APIs
and to the website you point it at, and stores everything it caches under your
home directory. There is no Searchlight-operated server, account, or telemetry
endpoint — because none exists in the code.

This document describes, precisely and without marketing, what Searchlight can
access, where your data lives, what leaves your machine, and the secrets that
ship inside the npm package. Every claim below is grounded in the source under
`src/`.

---

## 1. What Searchlight can access (OAuth scopes)

Searchlight authenticates to Google with OAuth and requests the **narrowest set
of scopes needed for the mode you run it in**. Scopes are assembled in
`scopes()` (`src/auth.ts:49-55`). Mode flags are parsed in `src/index.ts`
(`234-254`) and stored as environment variables read under the `SEARCHLIGHT_`
prefix (with a legacy `GSC_` fallback) in `src/config.ts:9-11`.

The scope constants (`src/auth.ts:18-20, 44-47`):

- `READONLY_SCOPE` — `https://www.googleapis.com/auth/webmasters.readonly`
- `WRITE_SCOPE` — `https://www.googleapis.com/auth/webmasters`
- `ANALYTICS_SCOPE` — `https://www.googleapis.com/auth/analytics.readonly`
- `SETUP_SCOPES` — `https://www.googleapis.com/auth/siteverification` and
  `https://www.googleapis.com/auth/analytics.edit`

### Scopes requested per mode

| Mode | Flag / env var | Scopes requested |
|------|----------------|------------------|
| **Default** (no flags) | — | `webmasters.readonly` + `analytics.readonly` (Analytics is ON by default, `auth.ts:37-40,52`) |
| **No analytics** | `--no-analytics` / `SEARCHLIGHT_DISABLE_ANALYTICS=1` | `webmasters.readonly` only |
| **Write** | `--write` / `--enable-write` / `SEARCHLIGHT_ENABLE_WRITE=1` | `webmasters` (full) + `analytics.readonly` (`auth.ts:51`) |
| **Setup** | `--setup` / `--enable-setup` / `SEARCHLIGHT_ENABLE_SETUP=1` | `webmasters` (full) + `analytics.readonly` + `siteverification` + `analytics.edit` (4 scopes) |

### Least-privilege notes

- **Read-only by default.** Out of the box Searchlight can only *read* Search
  Console and Analytics. It cannot modify, verify, or create anything.
- **`--setup` implies write.** Because setup implies write (`auth.ts:33-35`),
  running `--setup` alone escalates Search Console from read-only to **full
  write** (`webmasters`) and additionally grants `siteverification` and
  `analytics.edit`. Only enable setup mode when you actually intend to verify a
  site or create a GA4 property.
- **A refresh token is always requested.** Login uses
  `access_type: "offline"` and `prompt: "consent"` (`auth.ts:197-201`), so
  Google issues a long-lived refresh token. See §2 for how it is stored.
- **No Google Tag Manager scope is ever requested.** GTM was intentionally
  dropped; `SETUP_SCOPES` contains no `tagmanager` scope (`auth.ts:42-43`).
  Provisioning code that references `google.tagmanager` still exists in
  `src/provision.ts` (`16-19, 167-196`), but with no `tagmanager` scope ever
  granted, that path is non-functional dead code.
- **You can inspect what was actually granted.** `grantedScopes()`
  (`auth.ts:62-69`) reads the real granted scopes back from the stored token's
  `scope` field, so the effective permissions are always visible.

---

## 2. Where your data lives (local-first)

Everything Searchlight persists is written with `node:fs` under a single
directory. **There is no Searchlight server and no upload path** — nothing you
see below is transmitted to any Searchlight-operated endpoint.

The root is `CONFIG_DIR`, default `~/.searchlight` (`config.ts:25-35`). It can
be overridden with `SEARCHLIGHT_HOME` (or legacy `GSC_MCP_HOME`), and a
pre-existing `~/.gsc-mcp` directory is reused if present.

### The token (the crown jewel)

| Secret | Path | File mode |
|--------|------|-----------|
| **OAuth tokens** (access token, refresh token, granted scopes) | `~/.searchlight/token.json` (`config.ts:36`) | **`0o600`** (owner read/write only), set explicitly at `auth.ts:160` |

`token.json` is written by `saveToken` (`auth.ts:148-161`), which merges on
write to preserve the `refresh_token` across refreshes, and is read back at
`auth.ts:171`. `logout()` deletes it (`auth.ts:259-261`). This file grants
whatever scopes you consented to — including full write, site verification, and
`analytics.edit` if you ran write or setup mode — so treat it as a credential.
It is the **only** file Searchlight writes with an explicit restrictive mode.

### Cached data (per site)

Per-site data lives under `~/.searchlight/sites/<hash>/`, where `<hash>` is an
8-hex-character **non-cryptographic** hash of the property URL (`siteDir`,
`config.ts:102-110`). The hash is only a folder-namespacing convenience — it is
**not** a privacy or security control (the plaintext property URLs are stored
inside the files themselves).

| File | Written by | Contents |
|------|-----------|----------|
| `config.json` | `saveConfig` (`config.ts:63-66`) | default site + friendly aliases → property URLs |
| `sites/<hash>/candidates.json` | `coverage.ts:166` | candidate URL list (from sitemaps + GSC `page` dimension) |
| `sites/<hash>/coverage.json` | `coverage.ts:208` | per-URL inspection results: verdict, coverage state, robots/indexing/fetch state, Google & user canonical, last crawl time, sitemap membership (`coverage.ts:19-32`) |
| `sites/<hash>/quota.json` | `cache.ts:49` | daily URL-Inspection call counts (`cache.ts:41-50`) |
| `sites/<hash>/meta.json` | `coverage.ts:167,210` | last candidate/inspect refresh timestamps |
| `sites/<hash>/crawl.json` | `crawl.ts:422` | full crawl records: status, redirect chains, headers (X-Robots-Tag, content-type), title/canonical/meta-robots, hreflang, internal-link graph, indexability (`crawl.ts:32-53`) |
| `sites/<hash>/crawl-state.json` | `crawl.ts:423` | resumable crawl frontier + parsed robots rules + origins |
| `sites/<hash>/snapshots/<YYYY-MM-DD>.json` | `snapshot.ts:78-81` | health score/grade, GSC metrics (28-day clicks/impressions, indexed/not-indexed), issue findings |

### File-mode caveat on multi-user POSIX hosts

Only `token.json` is `0o600`. **Every other file is written with plain
`fs.writeFileSync` and no `mode` option**, so it inherits the process umask
(commonly `0644`, world-readable) on POSIX systems — this applies to
`config.json` (`config.ts:65`), all site cache via `writeSiteJson`
(`cache.ts:24-28`), and snapshots (`snapshot.ts:78`). Directories are created
with `mkdirSync({ recursive: true })` and no explicit mode (`cache.ts:12-14`,
`snapshot.ts:47`, `auth.ts:149`, `config.ts:64`), i.e. the default `~0755`.

**Net effect:** on a shared POSIX machine, other local users may be able to read
your cached search-analytics URLs, coverage data, and crawl data. Your OAuth
token is protected (`0o600`); the cached data around it is not. On Windows these
POSIX modes are largely ignored. If you run Searchlight on a multi-user host,
restrict access to `~/.searchlight` yourself (e.g. `chmod 700 ~/.searchlight`).

---

## 3. What leaves your machine, and to whom

Searchlight makes outbound network calls to exactly **two kinds of destination**:
Google APIs, and the live website you point it at. No third-party, analytics, or
telemetry endpoint appears anywhere in `src`.

### A. Google APIs (authenticated with your OAuth bearer token)

- **Search Console v1** (`google.searchconsole`, `gsc.ts:15`):
  `searchanalytics.query` (`gsc.ts:118`), `sitemaps.list`
  (`coverage.ts:85`, `diagnose.ts:233`), and
  `urlInspection.index.inspect` (`coverage.ts:113`). Sends: the site URL, date
  ranges, dimensions/filters, and the specific URLs being inspected.
- **Analytics Data v1beta + Admin v1beta** (`ga.ts:17,25`):
  `accountSummaries.list`, `properties.dataStreams.list`, and
  `properties.runReport` (`ga.ts:50,64,96,148`). Sends: property IDs and report
  dimensions/metrics/date ranges.
- **Setup mode only** — Site Verification v1 (`provision.ts:13`, `getToken` /
  `insert`) and Analytics Admin `properties.create` / `dataStreams.create`
  (`provision.ts:70,79`). Sends: site identifiers, new GA4 property
  name/timezone/currency, and website URL.

### B. PageSpeed Insights (Google)

A plain `fetch` to
`https://www.googleapis.com/pagespeedonline/v5/runPagespeed`
(`speed.ts:56-58`). The query string carries `strategy`,
`category=performance`, the **target URL** (`encodeURIComponent(url)`), and the
**bundled PSI API key in cleartext** (`&key=${key}`). Google then fetches your
target URL server-side and returns performance data; CrUX field data comes
embedded in this same response (`data.loadingExperience`, `speed.ts:92-97`).

### C. Your own live site (direct `fetch`, no credentials)

Searchlight fetches the website you are analyzing directly. These requests carry
no OAuth token — they are ordinary HTTP requests to your site:

- **Recursive crawler** — pages (`crawl.ts:220`) and robots.txt/sitemaps via
  `fetchText` (`web.ts:9`, called at `crawl.ts:357,364`).
- **On-page auditor** — the single user-specified URL (`audit.ts:291`).
- **Diagnose probes** — `https://<host>/sitemap.xml`, `/robots.txt`, and
  `/llms.txt` (`diagnose.ts:128,194,198,368`).
- **Coverage candidate seeding** — sitemap URLs via `fetchText`
  (`coverage.ts:60`).

### What does *not* leave your machine

- **Deep links are strings, not requests.** `deeplinks.ts:21-26` only *builds*
  `https://search.google.com/search-console?...` URLs for you to click; nothing
  is fetched.
- **The `googletagmanager.com` URLs** in `provision.ts:24,35` are literal
  strings inside generated HTML snippets — Searchlight never fetches them.
- **No direct CrUX call.** `cruxApiKey()` is defined (`keys.ts:29-31`) but is
  never called anywhere in `src`. There is no request to
  `chromeuxreport.googleapis.com`; CrUX data arrives only via the PSI response
  above. The bundled CrUX key is therefore effectively unused.
- **No telemetry / phone-home.** No third-party host, no logging endpoint, and
  no non-Google/non-target-site `fetch` exists in the source. Login progress is
  written to **stderr only** (`auth.ts:189,228-230,246-248`), keeping stdout
  clean for the MCP protocol.
- **The OAuth flow stays on localhost.** `login()` binds an ephemeral port on
  `127.0.0.1` (`auth.ts:191-194`); the authorization code is received locally
  and exchanged directly with Google (`auth.ts:238`). The redirect never leaves
  your machine.
- **The token is only ever sent to Google.** `token.json` is transmitted only to
  Google's token endpoint by the `googleapis` client during refresh — never to
  any Searchlight-operated server, because there is none.

### Crawler behavior and safety limits

Searchlight fetches your live site with an honest User-Agent and conservative
limits.

**Recursive crawler (`src/crawl.ts`):**
- **User-Agent:** `searchlight site crawler` (`crawl.ts:20`).
- **Robots obedience:** yes for page fetches — `isDisallowed()` is checked
  before every fetch (`crawl.ts:389`) using longest-match / Allow-wins semantics
  (`web.ts:97-104`). Caveat: only the `User-agent: *` group is parsed
  (`parseRobots`, `crawl.ts:140-158`); a rule targeting a *specific* UA beyond
  `*` is not applied. `nofollow` links are not enqueued (`crawl.ts:407`) and
  `noindex` is respected.
- **Concurrency:** 6 parallel fetches (`CONCURRENCY`, `crawl.ts:23,398`).
- **Politeness:** ~600 ms minimum spacing between batches (`crawl.ts:417`).
- **Volume caps:** 150 pages per run (resumable) and a hard ceiling of 5000
  pages total per site (`crawl.ts:21-22,383,411`).
- **Redirects:** manual-follow, max 8 hops, with loop detection
  (`crawl.ts:24,214-254`).
- **Same-site boundary:** enforced by `boundaryFor()` (`crawl.ts:91-117`) —
  URL-prefix properties stay on the same host and path prefix; `sc-domain:`
  properties allow the domain and its subdomains. Only `http:`/`https:` URLs are
  followed (`crawl.ts:71-80`), and sitemap-index expansion is capped at 50
  children (`crawl.ts:188`).

**Coverage crawler (`src/coverage.ts`):**
- **User-Agent:** `searchlight coverage crawler` (`coverage.ts:5`). It fetches
  only sitemap XML and does **not** consult robots.txt before doing so.
- **URL Inspection API:** batch size 8, ~1000 ms spacing to stay under
  ~600/min (`coverage.ts:184,205`), with a **daily quota of 2000 inspections per
  property** (`URL_INSPECTION_DAILY_QUOTA`, `coverage.ts:14,179`) tracked in
  `quota.json`. Candidate cap 50000, sitemap recursion depth ≤ 2
  (`coverage.ts:16-17,57`).

**On-page auditor (`audit.ts:291`) and diagnose probes (`diagnose.ts:128`):**
one-shot fetches of explicitly-named URLs (the page you requested, or the site's
own `sitemap.xml` / `robots.txt` / `llms.txt`). User-Agents
`searchlight on-page auditor` and `searchlight` respectively. Neither consults
robots.txt first (they fetch only the page you named or the site's own control
files), and neither uses concurrency or a rate loop. The auditor follows
redirects automatically; diagnose follows them manually.

---

## 4. Secrets shipped inside the npm package

Two secrets are bundled into the published tarball. Both are gitignored in the
source repository but included when the package is installed, which means
**anyone who installs Searchlight can extract them**. This section states
plainly what they are and what the real risk is.

### Bundled OAuth client (`bundled-client.json`)

Read by `readBundledClientFile` (`auth.ts:84-97`) from `../bundled-client.json`
relative to the compiled module (the package root, one level above `dist/`). It
holds a `client_id` and `client_secret`. Credential precedence is defined in
`loadClientCredentials` (`auth.ts:106-131`):

1. `SEARCHLIGHT_OAUTH_CLIENT_ID` + `SEARCHLIGHT_OAUTH_CLIENT_SECRET`
2. `SEARCHLIGHT_OAUTH_CREDENTIALS` (path to a credentials file)
3. `SEARCHLIGHT_BUNDLED_CLIENT_ID` + `SEARCHLIGHT_BUNDLED_CLIENT_SECRET`
4. `bundled-client.json`

**Honest risk assessment.** Shipping the OAuth client secret to every installer
is standard for a Google **"installed application"** client, where the secret is
explicitly *not* treated as confidential — the security of the flow rests on the
localhost redirect and the user's own consent, not on the secret. The bundled
secret does **not** grant access to anyone's data: each user must still complete
Google's consent screen, and the resulting token is stored only on their own
machine (§2). If you would rather use your own OAuth client, supply it via the
environment variables above, which take precedence over the bundled file.

### Bundled API keys (`bundled-keys.json`)

Read by `src/keys.ts:15-21`: a `pagespeedApiKey` and an optional `cruxApiKey`.
Shipped in the tarball, and **not** written into `CONFIG_DIR`.

**Honest risk assessment.** The PageSpeed Insights key is a Google **project
API key**, not user data — it authorizes API calls against a shared project
quota, nothing more. Because it is bundled and additionally sent in cleartext in
PSI request query strings (`speed.ts:57`), it is trivially extractable and could
be abused to consume the shared quota; the only consequence of such abuse is PSI
rate-limiting for Searchlight users. The `cruxApiKey` is currently unused
(`cruxApiKey()` is never called; see §3).

---

## 5. Reporting a vulnerability

If you find a security issue in Searchlight, please report it privately rather
than opening a public issue.

- **Preferred:** open a private security advisory via GitHub's "Report a
  vulnerability" on the repository's **Security** tab.
- **Email:** ajmalaksar25@gmail.com

Please include enough detail to reproduce (affected file/version, steps, and
impact). You will get an acknowledgement, and fixes for confirmed issues will be
released as promptly as is practical. Do not include live credentials or another
person's data in your report.
