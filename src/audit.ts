import * as cheerio from "cheerio";
import type { Severity, Finding } from "./diagnose.js";

/**
 * On-page audit: fetch a live URL and report fixable issues in the same
 * plain-English "why + what to do" shape as diagnose_site. Covers the on-page,
 * content, social-preview, structured-data, and analytics-tag layers of a
 * professional audit. Generic checks — nothing hardcoded per site. See SPEC §9.
 */
export interface AuditResult {
  url: string;
  finalUrl: string;
  status: number;
  fetchedAt: string;
  score: number;
  grade: string;
  summary: {
    title: string | null;
    titleLength: number;
    metaDescription: string | null;
    metaDescriptionLength: number;
    canonical: string | null;
    h1Count: number;
    wordCount: number;
    framework: string | null;
    analytics: { ga4: string | null; gtm: string | null; universal: string | null };
    jsonLdTypes: string[];
    imagesMissingAlt: number;
    imagesTotal: number;
    internalLinks: number;
    externalLinks: number;
  };
  openGraph: Record<string, string | null>;
  twitter: Record<string, string | null>;
  findings: Finding[];
}

function detectAnalytics(html: string): { ga4: string | null; gtm: string | null; universal: string | null } {
  const ga4 = html.match(/gtag\/js\?id=(G-[A-Z0-9]+)/i)?.[1] ?? html.match(/['"](G-[A-Z0-9]{6,})['"]/)?.[1] ?? null;
  const gtm = html.match(/GTM-[A-Z0-9]+/i)?.[0] ?? null;
  const universal = html.match(/['"](UA-\d{4,}-\d+)['"]/)?.[1] ?? null;
  return { ga4, gtm, universal };
}

function detectFramework(html: string, $: cheerio.CheerioAPI): string | null {
  if (html.includes("__NEXT_DATA__") || html.includes("/_next/")) return "Next.js";
  if (html.includes("__NUXT__")) return "Nuxt";
  if (/<astro-island|data-astro-/i.test(html)) return "Astro";
  if (html.includes("data-sveltekit")) return "SvelteKit";
  const gen = $('meta[name="generator"]').attr("content");
  if (gen) return gen;
  return null;
}

export async function auditPage(rawUrl: string): Promise<AuditResult> {
  const findings: Finding[] = [];
  const add = (
    severity: Severity,
    id: string,
    title: string,
    why: string,
    whatToDo: string,
    technical?: string
  ) => findings.push({ id, severity, title, why, whatToDo, technical });

  let res: Response;
  let html = "";
  let status = 0;
  let finalUrl = rawUrl;
  try {
    res = await fetch(rawUrl, { headers: { "User-Agent": "searchlight on-page auditor" } });
    status = res.status;
    finalUrl = res.url || rawUrl;
    html = await res.text();
  } catch (e) {
    add(
      "critical",
      "fetch:failed",
      "The page could not be loaded",
      "We couldn't fetch this URL at all, so neither we nor Google can read it.",
      "Check the URL is public and the server is responding.",
      e instanceof Error ? e.message : String(e)
    );
    return emptyResult(rawUrl, finalUrl, status, findings);
  }

  if (status >= 400) {
    add(
      "critical",
      "fetch:status",
      `The page returns HTTP ${status}`,
      "An error status means the page is broken or missing — it can't be indexed.",
      "Fix the server response so the page returns 200.",
    );
    return emptyResult(rawUrl, finalUrl, status, findings);
  }

  const analytics = detectAnalytics(html);
  const $ = cheerio.load(html);
  const framework = detectFramework(html, $);

  // --- title ---
  const title = ($("title").first().text() || "").trim() || null;
  const titleLength = title?.length ?? 0;
  if (!title) {
    add("warning", "title:missing", "No <title> tag", "The title is the clickable headline in Google results — without it Google invents one.", "Add a unique, descriptive <title> (≈50–60 characters).");
  } else if (titleLength > 60) {
    add("info", "title:long", `Title is ${titleLength} characters (Google may truncate)`, "Titles over ~60 characters get cut off in search results.", "Tighten the title to ≈50–60 characters.");
  } else if (titleLength < 15) {
    add("info", "title:short", `Title is very short (${titleLength} chars)`, "A too-short title wastes a ranking and click opportunity.", "Expand it to describe the page in ≈50–60 characters.");
  }

  // --- meta description ---
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const metaDescriptionLength = metaDescription?.length ?? 0;
  if (!metaDescription) {
    add("warning", "meta:missing", "No meta description", "This is the summary text under your title in Google — without it Google picks a random snippet.", "Add a unique 1–2 sentence meta description (≈150–160 characters).");
  } else if (metaDescriptionLength > 165) {
    add("info", "meta:long", `Meta description is ${metaDescriptionLength} chars (may truncate)`, "Descriptions over ~160 characters get cut off.", "Trim to ≈150–160 characters.");
  }

  // --- canonical ---
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  if (!canonical) {
    add("warning", "canonical:missing", "No canonical tag", "Without a canonical, Google may treat slightly different URLs as duplicates and pick the wrong one.", "Add a self-referencing <link rel=\"canonical\"> pointing to this page's preferred URL.");
  }

  // --- robots noindex ---
  const robotsMeta = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  if (robotsMeta.includes("noindex")) {
    add("critical", "robots:noindex", "This page has a 'noindex' tag", "A noindex instruction tells Google to keep this page out of search entirely.", "Remove the noindex if you want this page to rank.", `meta robots = "${robotsMeta}"`);
  }

  // --- headings ---
  const h1Count = $("h1").length;
  if (h1Count === 0) {
    add("warning", "h1:missing", "No H1 heading", "The H1 is the main on-page heading that tells users and Google what the page is about.", "Add a single, descriptive <h1>.");
  } else if (h1Count > 1) {
    add("info", "h1:multiple", `${h1Count} H1 headings`, "Multiple H1s can dilute the page's main topic signal.", "Prefer a single H1, with H2/H3 for subsections.");
  }

  // --- viewport (mobile) ---
  if ($('meta[name="viewport"]').length === 0) {
    add("warning", "mobile:viewport", "No mobile viewport tag", "Without it the page won't render well on phones — and Google indexes the mobile version.", 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  }

  // --- lang ---
  if (!$("html").attr("lang")) {
    add("info", "html:lang", "No language set on <html>", "Helps Google and screen readers know the page's language.", 'Add a lang attribute, e.g. <html lang="en">.');
  }

  // --- Open Graph + Twitter ---
  const og = (k: string) => $(`meta[property="og:${k}"]`).attr("content")?.trim() || null;
  const openGraph = {
    title: og("title"),
    description: og("description"),
    image: og("image"),
    url: og("url"),
    type: og("type"),
  };
  const tw = (k: string) => $(`meta[name="twitter:${k}"]`).attr("content")?.trim() || null;
  const twitter = { card: tw("card"), title: tw("title"), image: tw("image") };
  if (!openGraph.image && !twitter.image) {
    add("warning", "social:image", "No social preview image (Open Graph)", "When your link is shared on X, LinkedIn, Slack, WhatsApp etc. it shows no image — far fewer clicks.", "Add og:image (and twitter:image), ~1200×630px.");
  }
  if (!openGraph.title && !openGraph.description) {
    add("info", "social:tags", "No Open Graph title/description", "Social platforms fall back to guessing your title/description.", "Add og:title and og:description.");
  }

  // --- structured data ---
  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const arr = Array.isArray(data) ? data : data["@graph"] ?? [data];
      for (const node of Array.isArray(arr) ? arr : [arr]) {
        const t = node?.["@type"];
        if (t) jsonLdTypes.push(...(Array.isArray(t) ? t : [t]));
      }
    } catch {
      /* invalid JSON-LD */
    }
  });
  if (jsonLdTypes.length === 0) {
    add("info", "schema:none", "No structured data (schema.org)", "Structured data makes you eligible for rich results and helps AI engines understand and cite you.", "Add JSON-LD for the page type (Article, Product, FAQ, etc.).");
  }

  // --- images alt ---
  const imagesTotal = $("img").length;
  const imagesMissingAlt = $("img").filter((_, el) => !($(el).attr("alt") || "").trim()).length;
  if (imagesMissingAlt > 0) {
    add("info", "img:alt", `${imagesMissingAlt} of ${imagesTotal} images have no alt text`, "Alt text helps Google understand images and is needed for accessibility.", "Add descriptive alt text to meaningful images.");
  }

  // --- links + word count ---
  let internalLinks = 0;
  let externalLinks = 0;
  const host = safeHost(finalUrl);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const h = safeHost(new URL(href, finalUrl).href);
    if (h && host && h === host) internalLinks++;
    else if (h) externalLinks++;
  });
  if (internalLinks < 3) {
    add("info", "links:internal", `Only ${internalLinks} internal links`, "Internal links help Google discover and rank your other pages — too few leaves pages orphaned.", "Link to related pages from this one.");
  }

  $("script, style, noscript").remove();
  const wordCount = ($("body").text().trim().match(/\S+/g) || []).length;
  if (wordCount < 300) {
    add("warning", "content:thin", `Thin content (~${wordCount} words)`, "Very short pages are often judged low-value and left unindexed ('Crawled - currently not indexed').", "Expand with genuinely useful, original content.");
  }

  // --- analytics tag ---
  if (!analytics.ga4 && !analytics.gtm && !analytics.universal) {
    add("info", "analytics:missing", "No Google Analytics tag found", "This page isn't being measured — you can't see its traffic or behaviour in Analytics.", "Add the GA4 tag (gtag.js) so this page is tracked.");
  }

  // --- score ---
  let score = 100;
  for (const f of findings) score -= f.severity === "critical" ? 15 : f.severity === "warning" ? 6 : 2;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  return {
    url: rawUrl,
    finalUrl,
    status,
    fetchedAt: new Date().toISOString(),
    score,
    grade,
    summary: {
      title,
      titleLength,
      metaDescription,
      metaDescriptionLength,
      canonical,
      h1Count,
      wordCount,
      framework,
      analytics,
      jsonLdTypes: [...new Set(jsonLdTypes)],
      imagesMissingAlt,
      imagesTotal,
      internalLinks,
      externalLinks,
    },
    openGraph,
    twitter,
    findings,
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function emptyResult(url: string, finalUrl: string, status: number, findings: Finding[]): AuditResult {
  return {
    url,
    finalUrl,
    status,
    fetchedAt: new Date().toISOString(),
    score: 0,
    grade: "F",
    summary: {
      title: null,
      titleLength: 0,
      metaDescription: null,
      metaDescriptionLength: 0,
      canonical: null,
      h1Count: 0,
      wordCount: 0,
      framework: null,
      analytics: { ga4: null, gtm: null, universal: null },
      jsonLdTypes: [],
      imagesMissingAlt: 0,
      imagesTotal: 0,
      internalLinks: 0,
      externalLinks: 0,
    },
    openGraph: { title: null, description: null, image: null, url: null, type: null },
    twitter: { card: null, title: null, image: null },
    findings,
  };
}
