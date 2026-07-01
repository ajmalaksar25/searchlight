/**
 * Build Search Console UI URLs for the surfaces the API does not expose
 * (Removals, Manual actions, Security issues, Page-indexing report). The tool
 * hands these to the user so they can act on what we can only read/diagnose.
 */
export type DeepLinkReport =
  | "removals"
  | "manualActions"
  | "securityIssues"
  | "pageIndexing"
  | "crawlStats"
  | "overview";

const PATHS: Record<DeepLinkReport, string> = {
  removals: "removals",
  manualActions: "manual-actions",
  securityIssues: "security-issues",
  pageIndexing: "index",
  crawlStats: "settings/crawl-stats", // Crawl Stats (Settings) — no API, UI only
  overview: "",
};

export function buildDeepLink(siteUrl: string, report: DeepLinkReport): string {
  const base = "https://search.google.com/search-console";
  const sub = PATHS[report];
  const path = sub ? `${base}/${sub}` : base;
  return `${path}?resource_id=${encodeURIComponent(siteUrl)}`;
}
