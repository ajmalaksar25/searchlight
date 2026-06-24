import { google, searchconsole_v1 } from "googleapis";
import { getAuthClient } from "./auth.js";
import { round } from "./util/result.js";

/**
 * Lazily build (and cache) an authorized Search Console v1 client.
 * The auth client type derives from googleapis itself (see auth.ts), so it
 * assigns cleanly here without a google-auth-library version clash.
 */
let cached: searchconsole_v1.Searchconsole | null = null;

export async function gscClient(): Promise<searchconsole_v1.Searchconsole> {
  if (cached) return cached;
  const auth = await getAuthClient();
  cached = google.searchconsole({ version: "v1", auth });
  return cached;
}

/** YYYY-MM-DD for `n` days before today (UTC). */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface AnalyticsRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

/** Flatten GSC rows into plain objects keyed by the requested dimensions. */
export function rowsToObjects(
  dimensions: string[],
  rows: AnalyticsRow[] | undefined
): Record<string, unknown>[] {
  return (rows ?? []).map((r) => {
    const o: Record<string, unknown> = {};
    dimensions.forEach((d, i) => {
      o[d] = r.keys?.[i];
    });
    o.clicks = r.clicks ?? 0;
    o.impressions = r.impressions ?? 0;
    o.ctr = round(r.ctr ?? 0, 4);
    o.position = round(r.position ?? 0, 1);
    return o;
  });
}

export const DIMENSIONS = [
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
  "date",
] as const;

export const FILTER_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "includingRegex",
  "excludingRegex",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface SearchAnalyticsArgs {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  dimensions?: Dimension[];
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  dimensionFilters?: {
    dimension: Dimension;
    operator?: FilterOperator;
    expression: string;
  }[];
  rowLimit?: number;
  startRow?: number;
  aggregationType?: "auto" | "byPage" | "byProperty";
  dataState?: "final" | "all";
}

/** Run a Search Analytics query, mapping our args onto the GSC request body. */
export async function runSearchAnalytics(
  args: SearchAnalyticsArgs
): Promise<searchconsole_v1.Schema$SearchAnalyticsQueryResponse> {
  const gsc = await gscClient();
  const dimensions = args.dimensions ?? [];
  const requestBody: searchconsole_v1.Schema$SearchAnalyticsQueryRequest = {
    startDate: args.startDate ?? daysAgo(28),
    endDate: args.endDate ?? daysAgo(2),
    dimensions,
    rowLimit: args.rowLimit ?? 1000,
    startRow: args.startRow ?? 0,
  };
  if (args.type) requestBody.type = args.type;
  if (args.aggregationType) requestBody.aggregationType = args.aggregationType;
  if (args.dataState) requestBody.dataState = args.dataState;
  if (args.dimensionFilters?.length) {
    requestBody.dimensionFilterGroups = [
      {
        groupType: "and",
        filters: args.dimensionFilters.map((f) => ({
          dimension: f.dimension,
          operator: f.operator ?? "equals",
          expression: f.expression,
        })),
      },
    ];
  }
  const res = await gsc.searchanalytics.query({ siteUrl: args.siteUrl, requestBody });
  return res.data;
}

export { round };
