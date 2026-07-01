---
name: searchlight
description: Searchlight — autonomous technical SEO and analytics for a website, using the searchlight MCP server for data + provisioning and the agent's repo access for fixes. Detects what's broken (indexing, canonical, redirect, sitemap, analytics, page speed, on-page), explains why in plain language with worry-levels, and — with the user's confirmation — fixes it in the repo, deploys, and verifies. Triggers on /searchlight (and /searchlight audit | setup | fix), or when the user wants to set up SEO/analytics, fix indexing, or audit a site's search quality.
---

# Searchlight

Run a website from "I don't know what's wrong" to "fixed and verified", using the `searchlight`
MCP server for data + provisioning and the agent's repo access for fixes. Meet the user where
they are (beginner → pro). **Never act without confirming first.**

## Commands

Route on the first word of the argument; everything after is context (usually a site).

| Invocation | Does | Stops at |
|---|---|---|
| `/searchlight audit [site]` | Read-only diagnosis: detect + explain, triaged. **No changes, no provisioning, no deploy.** | end of §2, then offer to fix |
| `/searchlight setup [site]` *(or no arg)* | The full guided loop: interview → detect → confirm → provision → fix → deploy → verify | §5 |
| `/searchlight fix [site]` | Assume already audited; go straight to plan → confirm → fix → deploy → verify | §5 |

`audit` is the safe default to lead with for a nervous first-time user: show them the picture,
then ask whether to fix. `setup` / `fix` change real things and always confirm first.

## 0. Prerequisites (check, don't assume)
1. The `searchlight` MCP server must be connected. Call `auth_status` / `setup_status`.
   - Not authenticated → tell them to run `searchlight login --setup`, or use the `auth_login` tool.
   - **For the full hands-off run, the server must be in setup mode** (`setupMode: true`, started with `--setup`) and the token must include the setup scopes (re-login with `--setup`). `--setup` is self-sufficient: it turns on provisioning (GA4/GTM/verification) **and** Search Console writes (sitemap submit) and reports `writeEnabled: true`. If `setupMode` is false or scopes are missing, say so up front and give the exact one-time command before proposing any write/provision step — don't discover it mid-run. (For `audit`, read-only auth is enough; you don't need setup mode.)
2. If the user's **site code is open in this workspace**, you can apply fixes. If not (hosted CMS), you give exact instructions instead of editing.

## 1. Interview FIRST (ask, confirm — don't barrel ahead)
*(For `audit`, keep this to one line: which site? Then go straight to §2 and stop after.)*
Ask only what you need, in plain language, and confirm before doing anything:
- **Which site?** (`list_sites`; resolve an alias or pick.)
- **What's the goal?** (rank a new site / fix indexing / add analytics / general audit.)
- **Analytics:** do they want it? Create a **new** GA4 property or connect an **existing** one? (`ga_list_properties` to see what exists.) Under which account? (`list_ga_accounts`.) Searchlight installs the GA4 tag directly via the gtag snippet.
- **What do they want to track?** (key events/conversions — keep it simple for beginners.)
- **Code in this repo, or hosted?**

Summarize their answers as a short plan and get a yes before executing.

## 2. Detect — build the picture
- **First, before any fix: `snapshot_baseline <site>`.** This freezes today's health so the before→after is real data, not reconstructed after the fact. Always capture it at the start of a run — don't leave it as an afterthought. *(For `audit`-only, the snapshot is optional but cheap; capture it so a later fix has a baseline.)*
- `setup_status <site>` → GSC verified? matching GA4 property? sitemap submitted? Also confirms `setupMode`/`writeEnabled`.
- `diagnose_site <site>` → triaged health (fix-now / worth-improving / fine / working) with why + what-to-do.
- `refresh_coverage <site>` then `coverage_report` → which pages are/aren't indexed and why (run once to populate).
- For key pages: `audit_page <url>` → title/meta/canonical/H1/OG/schema/alt/content-depth + **GA tag presence**.
- If a GA4 property exists but the tag is missing: `ga_measurement_id <site>` → **fetch the `G-XXXX` ID automatically** (don't ask the user to paste it). Only ask for it if no property matches the site and none is being created.
- `page_speed <url>` → Core Web Vitals.
- `ga_report` (preset `traffic`) / `query_search_analytics` (preset `top_pages`) / `find_opportunities` → is anyone arriving, and from where.

Present findings as **plain-English, triaged** ("fix now: …, here's why, here's the fix"). Distinguish what to worry about vs what's normal (e.g. "Page with redirect" is usually fine). **If the command was `audit`, stop here:** give the triaged picture and ask whether to fix the things worth fixing (which continues into §3).

## 3. Plan → confirm → execute
Order the work by impact (fix blockers before discovery before polish). For each item, show the fix and confirm. Typical blockers, in order:
1. **robots / verification errors** (e.g. a subdomain robots.txt returning 4xx) → fix the handler or guide DNS.
2. **broken redirects** (`Redirect error`) → one clean hop to a 200.
3. **sitemap unreachable** (307/404) → make `/sitemap.xml` return 200 with canonical URLs; then `submit_sitemap` (write mode).
4. **discovery** (`URL is unknown to Google`) → ensure pages are in the reachable sitemap + internally linked.
5. **on-page** → titles, meta, canonical, OG image, schema, content depth (delegate copy to `seo-content-writer`; AI-citability to `ai-seo`).
6. **analytics gap** → see §4.

### Provisioning (setup mode only — confirm each; these are real, account-level)
- **GA4:** `list_ga_accounts` → `create_ga4_property` (returns measurement ID + gtag snippet). Prefer connecting an existing clean per-site property; if only Firebase-default/junk properties exist, recommend creating one clean property per site (don't auto-delete — guide the user to remove stale ones).
- **Verification (new sites):** `get_verification_token` → for **domain properties** (`sc-domain:`) this is a **DNS TXT record the user must add** (give the exact value + their host's steps, e.g. Cloudflare, DNS-only) → `verify_site`. For URL-prefix, inject the meta/file into the repo and verify.

## 4. Fix in the repo — framework-aware, not hardcoded
Detect the stack (`audit_page` reports `framework`; or read the repo). Apply the idiomatic fix:
- **Sitemap/robots:** Next.js → `app/sitemap.ts` / `app/robots.ts`; Astro → `@astrojs/sitemap`; etc. Ensure 200 + canonical (www vs non-www) URLs.
- **Redirects:** `next.config` / `vercel.json` / middleware — collapse loops to one hop.
- **Canonical host (www vs apex):** the live redirect must agree with the code's canonical (a split where the deployment redirects one way but `metadataBase`/canonicals point the other causes "Duplicate without user-selected canonical"). Fix at the layer that actually enforces it — **detect the host, don't assume Vercel**:
  - If the redirect is a **platform/domain setting** and that host's **CLI/API is installed** (Vercel, Netlify, Cloudflare, …), set the primary domain + redirect direction with it — check the tool's own help at runtime (`vercel domains --help`, `netlify --help`, `wrangler --help`) for the exact subcommand rather than assuming a flag.
  - Else enforce it **in code** (`next.config` redirects / middleware / `vercel.json` / `_redirects` / `.htaccess` as the stack dictates) — this is the portable fallback that works regardless of host.
  - Else (managed host with no CLI) give the user the exact dashboard steps.
  Pick ONE canonical host and make redirect + canonical + sitemap URLs all agree. Confirm the fix by re-auditing and showing the `finalUrl` now resolves to the chosen host (that flip is the proof).
- **Canonical / meta / OG image / lang / viewport:** the framework's head/metadata API.
- **Structured data:** add JSON-LD for the page type (Article/Product/FAQ).
- **GA4 tag (gtag):** get the measurement ID from `create_ga4_property` (new property) or `ga_measurement_id` (existing property — fetch it, don't ask the user to paste it), then inject the gtag snippet into the site head/layout, consent-gated if the site has a consent banner (mirror the existing analytics setup, e.g. a Clarity component).

**Deploy it — don't hand it back.** Code edits only reach the live site on the next build, so the run isn't done until it's deployed. Detect the method and do it (confirm ONCE upfront, since it changes the live site, then run without re-prompting):
- **Vercel + git auto-deploy** (the common case): `git add` the edits, commit with a clear message, and `git push` — Vercel builds on push. Confirm the branch is the production branch first.
- **Vercel CLI** (linked `.vercel`/no git auto-deploy): `vercel --prod`.
- **Other hosts:** run the project's build/deploy command if there is one; otherwise tell the user the exact command.
Then verify against the deployed URL (below).

## 5. Verify and report
Re-run `diagnose_site` / `inspect_url` / `audit_page` to confirm each fix resolved — verify in-browser / against the deployed URL, don't just claim it. Then **capture an "after": `snapshot_baseline <site>` again, and run `progress_report <site>`** to diff against the baseline from §2 — that's the real, repeatable before→after (resolved / new / persisting issues + score & traffic deltas), not a hand-built table. Report what changed, what's still **pending external systems** and why (Google re-crawl ~days; GA "active" flag ~48h; these delays are identical for manual or automated, so they don't count against setup time), and the next-best action.

## Honesty rules
- Say what the tool **can't** see or do (no backlinks API; removals/manual-actions are UI-only → deep-link; DNS verification needs the user; new GA/GTM **accounts** can't be API-created).
- Never claim something is fixed/indexed without verifying.
- Confirm before any provisioning, code edit, sitemap submit, or deploy.
