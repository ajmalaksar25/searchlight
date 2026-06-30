# Searchlight Roadmap — Toward a Direct-Fetch Site Auditor

*Decision-ready merge of positioning, gap analysis, and build plan. All claims source-verified; the crawler is reframed as "no new Google scope" (not "no OAuth"), and detection is framed as competitor-grade brought into the fix-loop — not as unique detection.*

---

## 1. Executive summary

Searchlight is today best-in-class on two axes — **GSC/GA data interpretation** (coverage reconstruction, opportunities, period-compare, snapshots/regression) and **setup/install automation** (verification, GA4 provisioning, sitemap submission) — but it cannot answer "what is actually broken across *my* site?" because nothing fetches the whole site. The strategic fork is: stay a GSC/GA copilot, or grow a direct-fetch crawler. **The data forces the answer: one recursive crawler, built on the `fetch` + cheerio stack already in `src/audit.ts`, advances ~20 gap items at once and adds zero new Google OAuth scope and zero new infrastructure.** Recommendation: don't pick one — sequence them. Keep the identity ("GSC/GA copilot + setup-automation"), bolt a recursive auditor onto the existing direct-fetch primitives, and defer headless/log/AI-citation work to a later infra phase.

---

## 2. Honest positioning by site type

Searchlight lives in the **plumbing + diagnosis** layer, not the **tracking-model** layer. The framing is defensible exactly where its scope overlaps the automatable portion of a setup, and overstated everywhere else.

| Site type | Defensible claim | The boundary |
|---|---|---|
| **Custom / Next.js / Astro (PRIMARY)** | "No plugin shortcut exists. Searchlight does the canonical / host / redirect / sitemap / GA4 plumbing **and the diagnosis** — ~25 active minutes vs. 4–6 hours for a skilled dev (measured on Zawaaj)." | Label it "measured on Zawaaj, one custom site"; present manual hours as "typical," never a universal SLA. |
| **WordPress / content** | "Plugins (Site Kit, GTM4WP) already install the tags in ~15–45 min. Searchlight's edge is the **diagnose→fix→verify loop** — finding the canonical-vs-host conflict, the redirect chain, the noindex-in-sitemap, fixing it at the source, and proving it live." | Do **not** lead with "we save install time" — free plugins got there first; that invites an easy rebuttal. |
| **E-commerce** | "Searchlight gets your **base** GA4/GSC tag installed, firing, and verified, and fixes your technical-SEO foundation." | It does **NOT** build purchase/checkout event tracking. That 3–10 h of event mapping + QA is still a human's job. Cap any e-comm "hours saved" to the baseline-tagging slice (~1–4 h) and name the boundary. |

**Honest one-liner:** *"Searchlight automates the technical-SEO plumbing and the diagnosis behind it — the canonical/host/redirect/sitemap/GA4 work that costs a developer hours — then fixes it in your repo and verifies it live. It does not design your e-commerce conversion tracking."*

**The strongest under-used number is active-minutes:** ~25 active min (not 50 wall-clock) is the real founder cost, and manual benchmarks are almost entirely active human time — that is the honest apples-to-apples comparison.

**Over-claim guards:** (1) never quote e-commerce hours saved; (2) "GA4 live and verified" = base tag fires, not revenue tracked correctly — keep the PRODUCT.md disclaimer load-bearing; (3) don't generalize the Zawaaj run as a guarantee; (4) don't claim full Screaming Frog / Semrush / Perplexity coverage — Searchlight does not yet crawl full-site, build link/orphan graphs, analyze logs, or render JS.

---

## 3. Gap table (HAVE / PARTIAL / MISSING)

Classification: **HAVE** = ships and is complete for its data source; **PARTIAL** = primitive exists but single-URL-only, GSC-derived-only, or detection-without-validation; **MISSING** = no tool produces it. Tally: **HAVE 8 · PARTIAL 22 · MISSING 26** (of 56). The single most-repeated gap: a per-page primitive exists in `audit_page`, but no crawl applies it site-wide.

| Area | HAVE | PARTIAL | MISSING |
|---|---|---|---|
| **A. Crawl & index** | Index coverage (#3) | Issue classification by severity (#2), crawl-vs-index reconciliation (#4) | Full-site crawler (#1), internal-link graph (#5), orphan detection (#6) |
| **B. Signal validation** | Google-selected vs declared canonical (#11) | robots.txt fetchability (#7), meta-robots index/noindex (#8), declared canonical (#10), combined indexability verdict (#13) | X-Robots-Tag header (#9), hreflang (#12), canonical→non-indexable (#14), sitemap-blocked-by-robots (#15), noindex-in-sitemap (#16), mixed protocol (#17), trailing-slash/param (#18) |
| **C. Redirects / status** | — | status inventory (#19), 4xx (#22), 5xx (#23), soft-404 (#24) | redirect-chain (#20), redirect-loop (#21), 301-vs-302 guidance (#25) |
| **D. Sitemaps** | discovery/fetch (#26), submission status (#27) | health validation (#28), reconciled vs index (#30) | reconciled vs crawl (#29) |
| **E. Structured data / render** | rich-result eligibility (#32) | schema syntax validation (#31), Google live inspection (#35) | JS-render check (#33), rendered-vs-raw diff (#34) |
| **F. Performance / mobile** | CWV field data (#36) | Lighthouse lab (#37), CWV→SEO impact (#38), mobile usability (#39) | mobile rendering parity (#40) |
| **G. Params / duplicates** | — | — | URL-param analysis (#41), duplicate clustering (#42), per-cluster canonical (#43) |
| **H. Log / bot** | — | — | log analysis (#44), crawl-budget (#45), crawl-stats trends (#46) |
| **I. AI visibility** | — | machine-readable content audit (#48) | AI-bot crawlability (#47), entity-signal consistency (#49), citation scoring (#50) |
| **J. Product-level** | prioritized output (#54), guided setup (#56) | playbooks (#51), framework fix patterns (#52), baselines/re-crawl (#53), exportable reports (#55) | — |

**Two corrected gap-evidence notes:**
- **5xx (#23)** is *weaker* than originally scored: `STATE_MAP` (`diagnose.ts:46`) has **no 5xx key**, so GSC 5xx states fall through to the generic `info` default — they render as undifferentiated info, not critical. A 5xx `STATE_MAP` entry is needed.
- **Core Web Vitals (#36)** feasibility is **CrUX/PSI only** — CWV is *not* in the Search Console API (`speed.ts` uses the PSI endpoint, `cruxApiKey()` falls back to the PSI key). Drop the "GSC_API" label from that row.

---

## 4. The three buckets (emphasis: scope-free is the whole P1+P2)

### Bucket 1 — SCOPE-FREE (no *new* Google scope; extend the direct-fetch auditor into a recursive crawler)
Everything ships on the existing `fetch` + cheerio stack. **Important correction:** the *crawler logic* needs no new OAuth scope, but the current seed (`collectCandidates()`, `coverage.ts:100`) calls `gsc.sitemaps.list` + `runSearchAnalytics`, which **do** require `webmasters.readonly`. To make the engine genuinely OAuth-independent (and correct on fresh/never-submitted sites), the crawler must also seed from a **direct `/sitemap.xml` + `robots.txt` `Sitemap:` directive + homepage fetch** (like `probe()`), unioned with the GSC-derived set when available.

Crawler core + graph (#1, #4, #5, #6) · per-URL signals promoted site-wide (#7–#10, #13, #31) · status/redirect inventory (#19–#23, #25) · mismatch cross-checks (#14–#18) · sitemap deepening (#28–#30) · params/duplicates (#41–#43) · AI-crawl-derivable (#47, #48, #49) · logic/UX over new crawl data (#2, #51, #52, #54, #55, #53) · Lighthouse opportunities (#37 — just parse more of the PSI response already fetched).

### Bucket 2 — NEW-SCOPE (additional Google permission)
**Effectively EMPTY for the audit checklist.** Every `GSC_API` audit item is already unlocked by `webmasters.readonly` (index coverage, Google-selected canonical, rich-result eligibility, soft-404, sitemap status). The only non-read scopes (`siteverification`, `analytics.edit`, `webmasters` write) are write/provisioning and are **already implemented** behind `--setup`/`--write` for the J setup items. ➡️ **Broadening audit/crawl coverage requires no new Google consent screen.**

### Bucket 3 — NEW-INFRA (defer; do not block publishing)
Headless browser (#33, #34, #39, #40) · log files (#44, #45) · external AI-citation services (#50). Note: #46 (Crawl Stats) and #35 (Google's own render) are **UI-only with no API** — best Searchlight can do is a deep link, not data.

---

## 5. Prioritized roadmap

### TOP 3 to build first (all P1, all no-new-scope, all reuse the direct-fetch auditor)

1. **Crawler engine — `crawlSite()` + `crawl_site` tool.** Highest-leverage investment and a hard dependency for #2 and #3 and ~20 gap items. Recursive link-following fetcher that captures, per URL: HTTP status, **full redirect chain**, **response headers (unlocks X-Robots-Tag free)**, the parsed-HTML signal set, and the internal-link edges `auditPage` currently discards. **Correction:** `auditPage`'s default `fetch` (`audit.ts:71`) *auto-follows* redirects and collapses the chain to `res.url` — the crawler needs a separate `redirect:"manual"` loop to capture hops; this is not the same as the analyzer refactor.
2. **`site_audit` — crawl-scale findings aggregator.** Turns the crawl into Searchlight's signature output: status inventory, redirect-chain/loop/301-vs-302 report, fused per-URL indexability verdict, site-wide meta-robots/canonical promotion — all as the existing `Finding` shape, triaged and prioritized "fix these 10 first."
3. **Crawl-aware `diagnose_site` — cross-source reconciliation.** Fuse crawl × sitemap × robots × GSC index into mismatch flags: noindex-in-sitemap, sitemap-blocked-by-robots, canonical→non-indexable, orphans, crawl-vs-index. **Correction:** these checks (noindex-in-sitemap, orphan detection, etc.) are *table-stakes* in Screaming Frog/Sitebulb/Semrush — frame this as **"brings competitor-grade cross-source detection into the MCP and the fix-loop,"** not "detection no one else has." The actual moat is the fix-in-repo-and-verify loop + setup automation.

### Cross-cutting design rules
- **Core function first, then two surfaces** — each capability is an async fn in `src/*.ts`, exposed as an MCP tool *and* a CLI command (harness-agnostic).
- **Emit findings as structured data from the tool, not the skill** — framework fix patterns/playbooks must be in the tool's JSON so Codex/OpenCode users get them.
- **Long crawls resumable + CLI-runnable** — mirror `refreshCoverage`'s chunked/resumable design; MCP advances in bounded batches, full crawls run via `searchlight crawl … --deep`.
- **Tool-count discipline** — today is **38 tools** (`server.registerTool` across `src/tools/*`). Net new: `crawl_site`, `site_audit` (P1) + at most `export_report` (P2) → stays under ~41. Use a `view`/`category` param on `site_audit` for drill-down instead of new tools.
- **Dedupe/ownership rule (new):** `audit_page`, `site_audit`, and `diagnose_site` can now all emit canonical/indexability/noindex findings for the same URL. Site-wide checks must **suppress the per-URL duplicate** so the prioritized list doesn't triple-count.
- **Boundary correction:** `domainMatches` (`coverage.ts:52`) is a **URL-prefix match** (`url.startsWith(siteUrl)`), not registrable-domain logic — it would wrongly exclude legitimate same-site subdomains. Either implement real registrable-domain matching for the crawler boundary or relabel it with the caveat.

---

### Phase P1 — The crawler and its direct outputs (no new scope; ship before publishing)

| # | Feature | Surface | Effort |
|---|---|---|---|
| 1.1 | Recursive crawler engine (manual-redirect fetch loop; seed from GSC ∪ direct `/sitemap.xml`+robots`Sitemap:`+homepage) | new `src/crawl.ts` → `crawl_site` + `crawl --deep` CLI | **L** |
| 1.2 | Shared HTML/header analyzer (X-Robots-Tag, follow/nofollow, fused indexability) | extend `src/audit.ts` | **M** |
| 1.3 | `site_audit` aggregator: status + redirect + indexability, triaged + prioritized | new `site_audit` tool | **M** |
| 1.4 | Internal-link graph + orphan detection | extend `src/crawl.ts` | **M** |
| 1.5 | Crawl-aware `diagnose_site` cross-source mismatches (+ extend `probe()` to return robots.txt body) | extend `src/diagnose.ts` | **M** |

**1.1 Crawler engine** — `crawlSite(siteUrl, opts)`. Seed = `collectCandidates` ∪ direct `/sitemap.xml` + robots `Sitemap:` directive + homepage (so fresh/unsubmitted sites aren't thin). BFS-follow internal `<a href>` via a **`redirect:"manual"` fetch loop** (captures hop chain). Per URL: `{url, status, redirectChain[], finalUrl, headers, …signals, outLinks[]}`. Politeness: concurrency cap (reuse `refreshCoverage` throttle, `coverage.ts:204`), `maxPages`, same-site restriction, obey robots.txt. Persist `crawl.json`+`graph.json`; resumable cursor like coverage. *Accept:* discovers link-only (non-sitemap) pages + sitemap pages on a fresh site with no GSC submission; ≥2-hop chains captured; `x-robots-tag` recorded; resumes without re-fetch; obeys robots disallow + concurrency cap.

**1.2 Shared analyzer (refactor)** — extract `auditPage`'s parse block (`audit.ts:98-219`) into `analyzeHtml(html, headers, url)`. Add: read `x-robots-tag`; parse follow/nofollow; fuse `indexable = status==200 && !noindex(meta||header) && !robots-disallowed && (canonical==self || empty)`. *Accept:* `X-Robots-Tag: noindex` (no meta) reported non-indexable by both `audit_page` and `crawl_site`; existing `audit_page` fields unchanged (regression fixture).

**1.3 `site_audit`** — `Finding[]` (shape from `diagnose.ts:12`) for status buckets, redirect chains >1 hop, loops, 301-vs-302 guidance, non-indexable pages, site-wide canonical. Triage + rank by severity × affected-page-count. `view`/`category` param for pagination. *Accept:* seeded 3-hop chain and a loop each flagged with full hop list; a 302-for-permanent-move flagged, correct 301 not; critical-affecting-40 ranks above warning-affecting-2.

**1.4 Link graph + orphans** — adjacency from `outLinks`, in-degree per URL; orphans = candidate pages with crawl in-degree 0. Surface in `site_audit`. *Accept:* a sitemap page with no internal link reported orphan; linking to it clears it on re-crawl; in-degree matches a hand-verified fixture.

**1.5 Crawl-aware `diagnose_site`** — load `crawl.json` when present; emit joins: noindex-in-sitemap, canonical→non-indexable, http/https variants, trailing-slash/param dupes, sitemap×crawl×GSC three-way reconciliation. **Correction:** `probe()` (`diagnose.ts:117`) currently **discards the robots.txt body** (returns only status + `<loc>` count) — it must be extended to **return the robots.txt text** before rules can be parsed here (#7). Degrades gracefully when no crawl exists. *Accept:* sitemap URL with `noindex` → finding naming the URL; sitemap URL matched by a parsed `Disallow` flagged; canonical→404/noindex flagged with both URLs; with no `crawl.json`, output equals today's.

---

### Phase P2 — Deepen the crawl + cheap GSC/PSI wins + polish (still no new scope)

| # | Feature | Surface | Effort |
|---|---|---|---|
| 2.1 | hreflang (#12 — *demoted from checklist-P1; pure `analyzeHtml` add*) + schema syntax/required-prop validation (#31) | extend `src/audit.ts` | **M** |
| 2.2 | Sitemap health (#28 — *demoted from checklist-P1*) + explicit sitemap×index report (#30) | extend `coverage.ts`/`diagnose.ts` | **M** |
| 2.3 | Full-site re-crawl regression on snapshots (#53) | extend `src/snapshot.ts` | **M** |
| 2.4 | Framework-specific fix patterns + playbooks emitted by tools (#51, #52) | extend `audit.ts`/`diagnose.ts` findings | **M** |
| 2.5 | Exportable / audience-framed reports (#55) | new `export_report` tool (or CLI `report`) | **M** |
| 2.6 | Lighthouse opportunities/diagnostics array (#37) | extend `src/speed.ts` | **S** |
| 2.7 | CWV→SEO-impact mapping (#38) + soft-404 *crawl heuristic* (#24) + rich-result portfolio (#32) | extend `speed.ts`/`diagnose.ts`/inspection | **S–M** |
| 2.8 | URL-parameter analysis (#41 — *re-prioritized from checklist-P3*; cheap over crawl data) | extend `src/crawl.ts` | **S** |
| 2.9 | AI-bot crawlability: llms.txt + AI-UA robots rules (#47) | extend `diagnose.ts` `probe()` | **S** |
| 2.10 | Machine-readable content audit (#48) + entity-signal consistency (#49) — *previously dropped; cheap over crawl `@type` data* | extend `audit.ts`/`crawl.ts` | **S–M** |
| 2.11 | Crawl-stats deep link (#46 — UI-only, no API) | extend `src/deeplinks.ts` | **S** |
| 2.12 | Add 5xx entry to `STATE_MAP` (corrects #23 severity handling) | `src/diagnose.ts` | **S** |

**Corrections folded into P2:**
- **2.7 soft-404 (#24):** soft-404 is **already a named finding** (`STATE_MAP` "Soft 404" at `diagnose.ts:92`, emitted via the bucket loop). The genuinely new work is only an **independent crawl heuristic** (200 status + empty/error-like body) — claim only that, not "promote to first-class."
- **2.7 rich-result portfolio (#32):** `inspect_url` returns `richResultsResult` **live but uncached** — the `InspectionRecord` (`coverage.ts:16-29`) stores only index-status fields. A rollup requires **extending the cache schema** and re-spending the 2,000/day quota — note as a prerequisite.
- **2.1 / 2.2 demotions** from checklist-P1 are deliberate on effort grounds; hreflang in particular is a pure `analyzeHtml` add and could be pulled into P1 if desired.
- **2.10** rescues two scope-free items the earlier roadmap silently dropped.

*Representative accepts:* 2.1 — page missing reciprocal hreflang flagged; Product schema missing `name`/`offers` flagged. 2.4 — missing-canonical on Next.js returns `metadata.alternates.canonical` snippet; Astro returns the Astro equivalent (the load-bearing cross-harness fix: remediation becomes data, not skill-only). 2.6 — `page_speed` returns ranked opportunities with est. ms/byte savings. 2.9 — robots.txt blocking GPTBot reported; llms.txt presence reported.

---

### Phase P3 — New infrastructure (deferred; do not block publishing)

| # | Feature | Surface | Scope |
|---|---|---|---|
| 3.1 | JS-rendering check + rendered-vs-raw diff (#33, #34) | optional headless module | **new infra** (headless) |
| 3.2 | Mobile tap-targets / font-size / parity (#39, #40) | headless module | **new infra** |
| 3.3 | Duplicate-content clustering + per-cluster canonical (#42, #43) | extend `src/crawl.ts` | none (scope-free but compute-heavy) |
| 3.4 | Log-file analysis + bot/crawl-budget (#44, #45) | new ingestion + CLI `logs` | **new infra** (external data) |
| 3.5 | AI-visibility / citation-presence scoring (#50) | external-service integration | **new infra** (3rd-party) |

3.1 gate behind opt-in `playwright`/`puppeteer` peer dep so core stays light. 3.5 **over-claim guard:** ship as a clearly-separate measurement, never bundled into the technical-SEO "audit" score.

---

## 6. What we will NOT do

- **No new Google OAuth scopes for P1+P2.** Everything runs under the current lean set (`webmasters.readonly` + `analytics.readonly`); the only non-read scopes (`siteverification`, `analytics.edit`, `webmasters` write) already exist behind `--setup`/`--write`. This is the publishing-safety guarantee.
- **No new infrastructure until P3.** No headless browser, no log ingestion, no third-party AI services in the base install — keeps Google verification simple and install light.
- **No e-commerce conversion/event tracking.** Base GA4 tag only; purchase/checkout event mapping + QA stays a human's job (PRODUCT.md boundary).
- **No "complete technical-SEO bootstrap tool" framing.** P1+P2 upgrade Searchlight to "GSC/GA copilot + setup-automation **+ direct-fetch site auditor**" — not Screaming Frog/Semrush-complete. JS-render, logs, and AI-citation remain explicitly out until P3.
- **No data we can't get from an API.** Crawl Stats (#46) and Google's own rendered HTML (#35) are UI-only — we ship deep links, not fabricated data.
- **No unbounded crawls inside one MCP tool call.** Bounded resumable batches + a CLI path for full headless crawls is the only cross-harness-safe design.
- **No realistic claim of being "scope-free / safe if pointed anywhere."** The crawler is **no-*new*-scope**; keep concurrency caps + robots obedience in the engine so the same code is safe if ever pointed off the user's own verified property.

---

**Source anchors for implementers:** `src/audit.ts` (`auditPage` :55, auto-follow fetch :71, link extraction :199, framework detect :45) · `src/coverage.ts` (`collectCandidates` GSC-dependent :100-128, `domainMatches` prefix-match :52, resumable batch loop :205-226) · `src/diagnose.ts` (`Finding` :12, `probe` discards body :117-131, `STATE_MAP` no-5xx :46-107, triage :302) · `src/speed.ts` (PSI `audits` already parsed :63, `cruxApiKey`→PSI fallback) · `src/inspection.ts` (rich-results live, uncached :27). Tool count today: 38.