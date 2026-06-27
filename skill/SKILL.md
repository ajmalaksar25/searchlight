---
name: seo-setup
description: End-to-end SEO setup and improvement for a website using the gsc MCP server. Detects what's missing (indexing, sitemap, analytics, page speed, on-page issues), explains why in plain language with worry-levels, and — with the user's confirmation — provisions GA4/site-verification and fixes the site's code, then re-verifies. Use when the user wants to set up SEO/analytics for a site, fix indexing problems, or audit and improve a site's search quality.
---

# seo-setup

Run a website from "I don't know what's wrong" to "set up properly and improving", using the `gsc` MCP server for data + provisioning and the agent's repo access for fixes. Meet the user where they are (beginner → pro). **Never act without confirming first.**

## 0. Prerequisites (check, don't assume)
1. The `gsc` MCP server must be connected. Call `auth_status` / `setup_status`.
   - Not authenticated → tell them to run `gsc-mcp login --setup`, or use the `auth_login` tool.
   - **For the full hands-off run, the server must be in setup mode** (`setupMode: true`, started with `--setup`) and the token must include the setup scopes (re-login with `--setup`). `--setup` is self-sufficient: it turns on provisioning (GA4/GTM/verification) **and** Search Console writes (sitemap submit) and reports `writeEnabled: true`. If `setupMode` is false or scopes are missing, say so up front and give the exact one-time command before proposing any write/provision step — don't discover it mid-run.
2. If the user's **site code is open in this workspace**, you can apply fixes. If not (hosted CMS), you give exact instructions instead of editing.

## 1. Interview FIRST (ask, confirm — don't barrel ahead)
Ask only what you need, in plain language, and confirm before doing anything:
- **Which site?** (`list_sites`; resolve an alias or pick.)
- **What's the goal?** (rank a new site / fix indexing / add analytics / general audit.)
- **Analytics:** do they want it? Create a **new** GA4 property or connect an **existing** one? (`ga_list_properties` to see what exists.) Under which account? (`list_ga_accounts`.) GTM, or just the direct gtag snippet? (Recommend gtag unless they specifically want Tag Manager.)
- **What do they want to track?** (key events/conversions — keep it simple for beginners.)
- **Code in this repo, or hosted?**

Summarize their answers as a short plan and get a yes before executing.

## 2. Detect — build the picture
- `setup_status <site>` → GSC verified? matching GA4 property? sitemap submitted?
- `diagnose_site <site>` → triaged health (fix-now / worth-improving / fine / working) with why + what-to-do.
- `refresh_coverage <site>` then `coverage_report` → which pages are/aren't indexed and why (run once to populate).
- For key pages: `audit_page <url>` → title/meta/canonical/H1/OG/schema/alt/content-depth + **GA tag presence**.
- `page_speed <url>` → Core Web Vitals.
- `ga_traffic` / `top_pages` / `find_opportunities` → is anyone arriving, and from where.

Present findings as **plain-English, triaged** ("🔴 fix now: …, here's why, here's the fix"). Distinguish what to worry about vs what's normal (e.g. "Page with redirect" is usually fine).

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
- **GTM (only if chosen):** `list_gtm_accounts` → `create_gtm_container`. Needs an existing GTM account (one-time user click). Adding the GA4 tag inside GTM + publishing is currently manual.
- **Verification (new sites):** `get_verification_token` → for **domain properties** (`sc-domain:`) this is a **DNS TXT record the user must add** (give the exact value + their host's steps, e.g. Cloudflare, DNS-only) → `verify_site`. For URL-prefix, inject the meta/file into the repo and verify.

## 4. Fix in the repo — framework-aware, not hardcoded
Detect the stack (`audit_page` reports `framework`; or read the repo). Apply the idiomatic fix:
- **Sitemap/robots:** Next.js → `app/sitemap.ts` / `app/robots.ts`; Astro → `@astrojs/sitemap`; etc. Ensure 200 + canonical (www vs non-www) URLs.
- **Redirects:** `next.config` / `vercel.json` / middleware — collapse loops to one hop.
- **Canonical / meta / OG image / lang / viewport:** the framework's head/metadata API.
- **Structured data:** add JSON-LD for the page type (Article/Product/FAQ).
- **GA4 tag (gtag):** inject the snippet from `create_ga4_property` (or the existing measurement ID) into the site head/layout.
After editing, **re-deploy is the user's step** unless they ask you to (e.g. `vercel deploy`); then verify.

## 5. Verify and report
Re-run `diagnose_site` / `inspect_url` / `audit_page` to confirm each fix resolved. Report what changed, what's still pending (and why — e.g. "Google will re-crawl in a few days"), and the next-best action. If a baseline snapshot exists, show before→after.

## Honesty rules
- Say what the tool **can't** see or do (no backlinks API; removals/manual-actions are UI-only → deep-link; DNS verification needs the user; new GA/GTM **accounts** can't be API-created).
- Never claim something is fixed/indexed without verifying.
- Confirm before any provisioning, code edit, sitemap submit, or deploy.
