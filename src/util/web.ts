/**
 * Shared web-fetch + sitemap parsing helpers. Used by both coverage.ts (which
 * seeds URL-Inspection candidates from sitemaps) and crawl.ts (the direct-fetch
 * crawler) so the sitemap/loc parsing lives in exactly one place.
 */

/** GET a URL as text, throwing on a non-2xx status. Caller supplies the UA. */
export async function fetchText(url: string, userAgent: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract and entity-decode every <loc> URL from a sitemap or sitemap-index XML body. */
export function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}

/**
 * Match a URL path against one robots.txt rule value, honoring `*` (any run) and
 * a trailing `$` (end anchor). Returns the rule's specificity (its length minus
 * wildcards) on a match, or -1 on no match. Rules are prefix-anchored unless they
 * start with `*`. This replaces the naive `startsWith` that treated `/*.pdf` as
 * `/` and blocked entire sites.
 */
export function robotsMatchLen(path: string, rule: string): number {
  if (!rule) return -1;
  const anchored = rule.endsWith("$");
  const core = anchored ? rule.slice(0, -1) : rule;
  const parts = core.split("*");
  let idx = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "") continue; // leading/trailing/double * — matches any run
    if (i === 0) {
      if (!path.startsWith(part)) return -1; // no leading * => anchored at start
      idx = part.length;
    } else {
      const f = path.indexOf(part, idx);
      if (f < 0) return -1;
      idx = f + part.length;
    }
  }
  if (anchored && idx !== path.length) return -1;
  return core.replace(/\*/g, "").length;
}

/** True if robots.txt blocks `path`. Longest-match wins; Allow wins ties (Google's rule). */
export function robotsBlocks(path: string, disallow: string[], allow: string[] = []): boolean {
  let d = -1;
  let a = -1;
  for (const r of disallow) d = Math.max(d, robotsMatchLen(path, r));
  for (const r of allow) a = Math.max(a, robotsMatchLen(path, r));
  if (d < 0) return false; // nothing disallows it
  return a < d; // blocked only if no equal-or-more-specific Allow
}

/**
 * Canonical comparison/graph key for a URL: lowercased host, no fragment, and no
 * trailing slash (except root). Lets sitemap URLs, canonicals, and crawl records
 * be matched despite trailing-slash/case differences. Query is preserved.
 */
export function normKey(u: string, base?: string): string {
  try {
    const url = new URL(u, base);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.href;
  } catch {
    return u;
  }
}
