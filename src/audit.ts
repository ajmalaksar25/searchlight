import * as cheerio from "cheerio";
import type { Severity, Finding } from "./diagnose.js";

/**
 * On-page audit: fetch a live URL and report fixable issues in the same
 * plain-English "why + what to do" shape as diagnose_site. Covers the on-page,
 * content, social-preview, structured-data, and analytics-tag layers of a
 * professional audit. Generic checks — nothing hardcoded per site. See SPEC §9.
 *
 * The HTML parsing lives in analyzeHtml() so the site crawler (crawl.ts) and the
 * single-page auditor share ONE analyzer. auditPage() adds the fetch + the
 * plain-English findings on top of those signals.
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
    noindex: boolean;
    indexable: boolean;
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

// Minimal required-property checks for the common rich-result types. Missing any
// of these means the type won't qualify for its rich result in Google.
const SCHEMA_REQUIRED: Record<string, string[]> = {
  Article: ["headline"],
  NewsArticle: ["headline"],
  BlogPosting: ["headline"],
  Product: ["name"],
  Recipe: ["name", "image"],
  Event: ["name", "startDate"],
  JobPosting: ["title", "datePosted"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
  Organization: ["name"],
  LocalBusiness: ["name"],
  VideoObject: ["name", "thumbnailUrl"],
};

/** Parsed on-page signals shared by auditPage and the site crawler. */
export interface PageSignals {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  noindex: boolean; // meta robots OR X-Robots-Tag
  nofollow: boolean;
  indexable: boolean; // 200 + not noindex + not robots-disallowed
  h1Count: number;
  hasViewport: boolean;
  htmlLang: string | null;
  framework: string | null;
  analytics: { ga4: string | null; gtm: string | null; universal: string | null };
  openGraph: Record<string, string | null>;
  twitter: Record<string, string | null>;
  jsonLdTypes: string[];
  schemaInvalid: number; // count of JSON-LD blocks that failed to parse
  schemaIssues: string[]; // e.g. 'Product is missing "name"'
  hreflang: { lang: string; href: string }[];
  imagesTotal: number;
  imagesMissingAlt: number;
  links: string[]; // ALL unique, fragment-stripped, absolute http(s) links (for the crawler's own boundary)
  internalLinks: string[]; // subset of links that are same-HOST as this page (auditor's notion of internal)
  externalLinkCount: number;
  wordCount: number;
}

/**
 * Parse a fetched HTML document into the shared signal set. `opts.status`,
 * `opts.xRobotsTag`, and `opts.robotsDisallowed` let the caller fuse the final
 * indexability verdict (the crawler knows robots.txt; auditPage does not).
 */
export function analyzeHtml(
  html: string,
  opts: { url: string; status?: number; xRobotsTag?: string | null; robotsDisallowed?: boolean }
): PageSignals {
  const $ = cheerio.load(html);
  const analytics = detectAnalytics(html);
  const framework = detectFramework(html, $);

  const title = ($("title").first().text() || "").trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const metaRobots = ($('meta[name="robots"]').attr("content") || "").toLowerCase().trim() || null;
  const xr = (opts.xRobotsTag || "").toLowerCase();
  const noindex = (metaRobots?.includes("noindex") ?? false) || xr.includes("noindex");
  const nofollow = (metaRobots?.includes("nofollow") ?? false) || xr.includes("nofollow");
  const indexable = (opts.status ?? 200) === 200 && !noindex && !opts.robotsDisallowed;

  const h1Count = $("h1").length;
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const htmlLang = $("html").attr("lang") || null;

  const og = (k: string) => $(`meta[property="og:${k}"]`).attr("content")?.trim() || null;
  const openGraph = { title: og("title"), description: og("description"), image: og("image"), url: og("url"), type: og("type") };
  const tw = (k: string) => $(`meta[name="twitter:${k}"]`).attr("content")?.trim() || null;
  const twitter = { card: tw("card"), title: tw("title"), image: tw("image") };

  const jsonLdTypes: string[] = [];
  const schemaIssues: string[] = [];
  let schemaInvalid = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      schemaInvalid++; // broken JSON-LD is silently dropped by Google
      return;
    }
    const arr = Array.isArray(data) ? data : (data as Record<string, unknown>)["@graph"] ?? [data];
    for (const node of (Array.isArray(arr) ? arr : [arr]) as Record<string, unknown>[]) {
      if (!node || typeof node !== "object") continue;
      const t = node["@type"];
      const types = Array.isArray(t) ? (t as string[]) : t ? [t as string] : [];
      jsonLdTypes.push(...types);
      for (const ty of types) {
        for (const prop of SCHEMA_REQUIRED[ty] ?? []) {
          if (!(prop in node)) schemaIssues.push(`${ty} is missing "${prop}"`);
        }
      }
    }
  });

  const hreflang: { lang: string; href: string }[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang");
    const href = $(el).attr("href");
    if (!lang || !href) return;
    try {
      hreflang.push({ lang, href: new URL(href, opts.url).href });
    } catch {
      /* unparseable hreflang href */
    }
  });

  const imagesTotal = $("img").length;
  const imagesMissingAlt = $("img").filter((_, el) => !($(el).attr("alt") || "").trim()).length;

  const host = safeHost(opts.url);
  const allLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    try {
      const u = new URL(href, opts.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      u.hash = "";
      allLinks.add(u.href);
    } catch {
      /* unparseable href */
    }
  });
  const internal = [...allLinks].filter((l) => {
    const h = safeHost(l);
    return !!h && !!host && h === host;
  });
  const externalLinkCount = allLinks.size - internal.length;

  $("script, style, noscript").remove();
  const wordCount = ($("body").text().trim().match(/\S+/g) || []).length;

  return {
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    canonical,
    metaRobots,
    xRobotsTag: opts.xRobotsTag ?? null,
    noindex,
    nofollow,
    indexable,
    h1Count,
    hasViewport,
    htmlLang,
    framework,
    analytics,
    openGraph,
    twitter,
    jsonLdTypes: [...new Set(jsonLdTypes)],
    schemaInvalid,
    schemaIssues: [...new Set(schemaIssues)],
    hreflang,
    imagesTotal,
    imagesMissingAlt,
    links: [...allLinks],
    internalLinks: internal,
    externalLinkCount,
    wordCount,
  };
}

/**
 * A framework-aware code snippet for a given finding, emitted as DATA so any
 * harness (not just Claude Code) gets a concrete fix. Covers the common on-page
 * findings for Next.js / Astro, with an HTML fallback.
 */
export function fixFor(id: string, framework: string | null): string | undefined {
  const fw = (framework || "").toLowerCase();
  const isNext = fw.includes("next");
  const isAstro = fw.includes("astro");
  switch (id) {
    case "title:missing":
      return isNext
        ? "export const metadata = { title: 'A unique, descriptive page title' };"
        : "<title>A unique, descriptive page title</title>";
    case "meta:missing":
      return isNext
        ? "export const metadata = { description: 'A unique 150-160 character summary of this page.' };"
        : '<meta name="description" content="A unique 150-160 character summary of this page." />';
    case "canonical:missing":
      if (isNext) return "// app/<route>/page.tsx\nexport const metadata = {\n  alternates: { canonical: 'https://example.com/this-path' },\n};";
      if (isAstro) return '<!-- in <head> -->\n<link rel="canonical" href={Astro.url.href} />';
      return '<link rel="canonical" href="https://example.com/this-path" />';
    case "mobile:viewport":
      return isNext
        ? "// Next adds viewport by default; only if you overrode it:\nexport const viewport = { width: 'device-width', initialScale: 1 };"
        : '<meta name="viewport" content="width=device-width, initial-scale=1" />';
    case "html:lang":
      return isNext
        ? "// app/layout.tsx\nreturn <html lang=\"en\">{children}</html>;"
        : '<html lang="en">';
    case "social:image":
      return isNext
        ? "export const metadata = {\n  openGraph: { images: ['/og.png'] },\n  twitter: { card: 'summary_large_image', images: ['/og.png'] },\n};"
        : '<meta property="og:image" content="https://example.com/og.png" />\n<meta name="twitter:image" content="https://example.com/og.png" />';
    case "schema:none":
      return '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "..."\n}\n</script>';
    default:
      return undefined;
  }
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

  const sig = analyzeHtml(html, { url: finalUrl, status, xRobotsTag: res.headers.get("x-robots-tag") });

  // --- title ---
  if (!sig.title) {
    add("warning", "title:missing", "No <title> tag", "The title is the clickable headline in Google results — without it Google invents one.", "Add a unique, descriptive <title> (≈50–60 characters).");
  } else if (sig.titleLength > 60) {
    add("info", "title:long", `Title is ${sig.titleLength} characters (Google may truncate)`, "Titles over ~60 characters get cut off in search results.", "Tighten the title to ≈50–60 characters.");
  } else if (sig.titleLength < 15) {
    add("info", "title:short", `Title is very short (${sig.titleLength} chars)`, "A too-short title wastes a ranking and click opportunity.", "Expand it to describe the page in ≈50–60 characters.");
  }

  // --- meta description ---
  if (!sig.metaDescription) {
    add("warning", "meta:missing", "No meta description", "This is the summary text under your title in Google — without it Google picks a random snippet.", "Add a unique 1–2 sentence meta description (≈150–160 characters).");
  } else if (sig.metaDescriptionLength > 165) {
    add("info", "meta:long", `Meta description is ${sig.metaDescriptionLength} chars (may truncate)`, "Descriptions over ~160 characters get cut off.", "Trim to ≈150–160 characters.");
  }

  // --- canonical ---
  if (!sig.canonical) {
    add("warning", "canonical:missing", "No canonical tag", "Without a canonical, Google may treat slightly different URLs as duplicates and pick the wrong one.", "Add a self-referencing <link rel=\"canonical\"> pointing to this page's preferred URL.");
  }

  // --- robots noindex (meta OR X-Robots-Tag header) ---
  if (sig.noindex) {
    const src = sig.metaRobots?.includes("noindex") ? `meta robots = "${sig.metaRobots}"` : `X-Robots-Tag = "${sig.xRobotsTag}"`;
    add("critical", "robots:noindex", "This page has a 'noindex' instruction", "A noindex instruction tells Google to keep this page out of search entirely.", "Remove the noindex if you want this page to rank.", src);
  }

  // --- headings ---
  if (sig.h1Count === 0) {
    add("warning", "h1:missing", "No H1 heading", "The H1 is the main on-page heading that tells users and Google what the page is about.", "Add a single, descriptive <h1>.");
  } else if (sig.h1Count > 1) {
    add("info", "h1:multiple", `${sig.h1Count} H1 headings`, "Multiple H1s can dilute the page's main topic signal.", "Prefer a single H1, with H2/H3 for subsections.");
  }

  // --- viewport (mobile) ---
  if (!sig.hasViewport) {
    add("warning", "mobile:viewport", "No mobile viewport tag", "Without it the page won't render well on phones — and Google indexes the mobile version.", 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  }

  // --- lang ---
  if (!sig.htmlLang) {
    add("info", "html:lang", "No language set on <html>", "Helps Google and screen readers know the page's language.", 'Add a lang attribute, e.g. <html lang="en">.');
  }

  // --- Open Graph + Twitter ---
  if (!sig.openGraph.image && !sig.twitter.image) {
    add("warning", "social:image", "No social preview image (Open Graph)", "When your link is shared on X, LinkedIn, Slack, WhatsApp etc. it shows no image — far fewer clicks.", "Add og:image (and twitter:image), ~1200×630px.");
  }
  if (!sig.openGraph.title && !sig.openGraph.description) {
    add("info", "social:tags", "No Open Graph title/description", "Social platforms fall back to guessing your title/description.", "Add og:title and og:description.");
  }

  // --- structured data ---
  if (sig.jsonLdTypes.length === 0 && sig.schemaInvalid === 0) {
    add("info", "schema:none", "No structured data (schema.org)", "Structured data makes you eligible for rich results and helps AI engines understand and cite you.", "Add JSON-LD for the page type (Article, Product, FAQ, etc.).");
  }
  if (sig.schemaInvalid > 0) {
    add("warning", "schema:invalid", `${sig.schemaInvalid} structured-data block${sig.schemaInvalid > 1 ? "s are" : " is"} invalid JSON`, "Google silently ignores structured data it can't parse, so you get zero rich-result benefit from it — and don't find out.", "Fix the JSON syntax in your JSON-LD <script> tags (validate with Google's Rich Results Test).");
  }
  if (sig.schemaIssues.length > 0) {
    add("info", "schema:incomplete", `Structured data missing required propert${sig.schemaIssues.length > 1 ? "ies" : "y"}`, "Some schema.org types are missing properties Google requires, so they won't qualify for their rich result.", `Add: ${sig.schemaIssues.slice(0, 4).join("; ")}.`);
  }

  // --- images alt ---
  if (sig.imagesMissingAlt > 0) {
    add("info", "img:alt", `${sig.imagesMissingAlt} of ${sig.imagesTotal} images have no alt text`, "Alt text helps Google understand images and is needed for accessibility.", "Add descriptive alt text to meaningful images.");
  }

  // --- internal links ---
  if (sig.internalLinks.length < 3) {
    add("info", "links:internal", `Only ${sig.internalLinks.length} internal links`, "Internal links help Google discover and rank your other pages — too few leaves pages orphaned.", "Link to related pages from this one.");
  }

  // --- content depth ---
  if (sig.wordCount < 300) {
    add("warning", "content:thin", `Thin content (~${sig.wordCount} words)`, "Very short pages are often judged low-value and left unindexed ('Crawled - currently not indexed').", "Expand with genuinely useful, original content.");
  }

  // --- analytics tag ---
  if (!sig.analytics.ga4 && !sig.analytics.gtm && !sig.analytics.universal) {
    add("info", "analytics:missing", "No Google Analytics tag found", "This page isn't being measured — you can't see its traffic or behaviour in Analytics.", "Add the GA4 tag (gtag.js) so this page is tracked.");
  }

  // --- attach framework-aware fix snippets (emitted as data for any harness) ---
  for (const f of findings) {
    const fix = fixFor(f.id, sig.framework);
    if (fix) f.fix = fix;
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
      title: sig.title,
      titleLength: sig.titleLength,
      metaDescription: sig.metaDescription,
      metaDescriptionLength: sig.metaDescriptionLength,
      canonical: sig.canonical,
      noindex: sig.noindex,
      indexable: sig.indexable,
      h1Count: sig.h1Count,
      wordCount: sig.wordCount,
      framework: sig.framework,
      analytics: sig.analytics,
      jsonLdTypes: sig.jsonLdTypes,
      imagesMissingAlt: sig.imagesMissingAlt,
      imagesTotal: sig.imagesTotal,
      internalLinks: sig.internalLinks.length,
      externalLinks: sig.externalLinkCount,
    },
    openGraph: sig.openGraph,
    twitter: sig.twitter,
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
      noindex: false,
      indexable: false,
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
