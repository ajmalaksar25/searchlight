import { google, analyticsdata_v1beta, analyticsadmin_v1beta } from "googleapis";
import { getAuthClient } from "./auth.js";
import { daysAgo } from "./gsc.js";

/**
 * Google Analytics 4 access — the analytics half of "one login, full analytics".
 * Uses the analytics.readonly scope on the same OAuth client as Search Console.
 * Data API (reporting) + Admin API (discover which GA4 properties the user owns).
 * See SPEC §22.2.
 */
let dataCached: analyticsdata_v1beta.Analyticsdata | null = null;
let adminCached: analyticsadmin_v1beta.Analyticsadmin | null = null;

export async function gaData(): Promise<analyticsdata_v1beta.Analyticsdata> {
  if (dataCached) return dataCached;
  const auth = await getAuthClient();
  dataCached = google.analyticsdata({ version: "v1beta", auth });
  return dataCached;
}

export async function gaAdmin(): Promise<analyticsadmin_v1beta.Analyticsadmin> {
  if (adminCached) return adminCached;
  const auth = await getAuthClient();
  adminCached = google.analyticsadmin({ version: "v1beta", auth });
  return adminCached;
}

/** Turn an Analytics API error into a friendly message (commonly: scope not granted). */
export function gaErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/PERMISSION_DENIED|insufficient|forbidden|403|invalid_scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) {
    return (
      "Analytics access isn't granted yet. Enable the 'analytics.readonly' scope on your Google OAuth " +
      "consent screen, then run `gsc-mcp login` again (or the auth_login tool)."
    );
  }
  return msg;
}

export interface GaProperty {
  propertyId: string;
  displayName: string;
  account: string;
  urls: string[];
}

/** List GA4 properties the signed-in user can access, with their website URLs. */
export async function listProperties(): Promise<GaProperty[]> {
  const admin = await gaAdmin();
  const res = await admin.accountSummaries.list({ pageSize: 200 });
  const out: GaProperty[] = [];
  for (const acc of res.data.accountSummaries ?? []) {
    for (const p of acc.propertySummaries ?? []) {
      out.push({
        propertyId: (p.property ?? "").replace("properties/", ""),
        displayName: p.displayName ?? "",
        account: acc.displayName ?? "",
        urls: [],
      });
    }
  }
  for (const p of out) {
    try {
      const streams = await admin.properties.dataStreams.list({ parent: `properties/${p.propertyId}` });
      for (const s of streams.data.dataStreams ?? []) {
        const uri = s.webStreamData?.defaultUri;
        if (uri) p.urls.push(uri);
      }
    } catch {
      /* stream listing optional */
    }
  }
  return out;
}

export interface GaReportRow {
  [key: string]: string | number;
}

/** Run a GA4 report and flatten rows to plain objects keyed by dimension/metric name. */
export async function runReport(
  propertyId: string,
  opts: { days?: number; dimensions?: string[]; metrics: string[]; limit?: number; orderByMetricDesc?: string }
): Promise<{ rows: GaReportRow[]; totals: GaReportRow }> {
  const data = await gaData();
  const dims = opts.dimensions ?? [];
  const body: analyticsdata_v1beta.Schema$RunReportRequest = {
    dateRanges: [{ startDate: daysAgo(opts.days ?? 28), endDate: "today" }],
    dimensions: dims.map((name) => ({ name })),
    metrics: opts.metrics.map((name) => ({ name })),
    limit: String(opts.limit ?? 100),
    metricAggregations: ["TOTAL"],
  };
  if (opts.orderByMetricDesc) {
    body.orderBys = [{ metric: { metricName: opts.orderByMetricDesc }, desc: true }];
  }
  const res = await data.properties.runReport({ property: `properties/${propertyId}`, requestBody: body });
  const dimHeaders = (res.data.dimensionHeaders ?? []).map((h) => h.name ?? "");
  const metHeaders = (res.data.metricHeaders ?? []).map((h) => h.name ?? "");
  const flatten = (dimVals: { value?: string | null }[] = [], metVals: { value?: string | null }[] = []) => {
    const o: GaReportRow = {};
    dimHeaders.forEach((h, i) => (o[h] = dimVals[i]?.value ?? ""));
    metHeaders.forEach((h, i) => (o[h] = Number(metVals[i]?.value ?? 0)));
    return o;
  };
  const rows = (res.data.rows ?? []).map((r) => flatten(r.dimensionValues ?? [], r.metricValues ?? []));
  const totalsRow = res.data.totals?.[0];
  const totals = totalsRow ? flatten([], totalsRow.metricValues ?? []) : {};
  return { rows, totals };
}
