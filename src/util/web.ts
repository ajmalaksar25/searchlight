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
