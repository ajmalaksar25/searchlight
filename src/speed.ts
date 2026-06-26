import { pagespeedApiKey } from "./keys.js";
import type { Severity, Finding } from "./diagnose.js";

/**
 * Page speed via the PageSpeed Insights API, which bundles both Lighthouse lab
 * scores and CrUX real-user field data (LCP / INP / CLS). Real-user field data
 * is preferred when available; otherwise we report the lab estimate. See SPEC §10.
 */
export interface SpeedResult {
  url: string;
  strategy: "mobile" | "desktop";
  fetchedAt: string;
  lab: {
    performanceScore: number | null; // 0-100
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    fcpMs: number | null;
  };
  field: {
    hasData: boolean;
    overall: string | null;
    lcpMs: number | null;
    inpMs: number | null;
    cls: number | null;
  };
  findings: Finding[];
}

interface CruxMetric {
  percentile?: number;
  category?: string;
}

function verdict(metric: "lcp" | "inp" | "cls", value: number): Severity {
  const t = {
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
  }[metric];
  if (value <= t[0]) return "good";
  if (value <= t[1]) return "warning";
  return "critical";
}

export async function pageSpeed(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<SpeedResult> {
  const key = pagespeedApiKey();
  if (!key) {
    throw new Error(
      "No PageSpeed key configured. Set GSC_PAGESPEED_API_KEY (or run `npm run keys:sync` after adding it to .env)."
    );
  }
  const endpoint =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=${strategy}` +
    `&category=performance&url=${encodeURIComponent(url)}&key=${key}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PageSpeed API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();

  const audits = data.lighthouseResult?.audits ?? {};
  const num = (id: string): number | null => {
    const v = audits[id]?.numericValue;
    return typeof v === "number" ? Math.round(v * 100) / 100 : null;
  };
  const lab = {
    performanceScore:
      typeof data.lighthouseResult?.categories?.performance?.score === "number"
        ? Math.round(data.lighthouseResult.categories.performance.score * 100)
        : null,
    lcpMs: num("largest-contentful-paint"),
    cls: num("cumulative-layout-shift"),
    tbtMs: num("total-blocking-time"),
    fcpMs: num("first-contentful-paint"),
  };

  const le = data.loadingExperience?.metrics ?? {};
  const lcp = (le.LARGEST_CONTENTFUL_PAINT_MS as CruxMetric)?.percentile ?? null;
  const inp = (le.INTERACTION_TO_NEXT_PAINT as CruxMetric)?.percentile ?? null;
  const clsRaw = (le.CUMULATIVE_LAYOUT_SHIFT_SCORE as CruxMetric)?.percentile ?? null;
  const cls = clsRaw == null ? null : clsRaw / 100; // CrUX reports CLS×100
  const hasData = Boolean(data.loadingExperience?.metrics);
  const field = {
    hasData,
    overall: data.loadingExperience?.overall_category ?? null,
    lcpMs: lcp,
    inpMs: inp,
    cls,
  };

  // --- findings: prefer real-user field data, fall back to lab ---
  const findings: Finding[] = [];
  const add = (sev: Severity, id: string, title: string, why: string, whatToDo: string) =>
    findings.push({ id, severity: sev, title, why, whatToDo });
  const src = hasData ? "real users" : "a lab test";

  const lcpVal = hasData ? lcp : lab.lcpMs;
  if (lcpVal != null) {
    const v = verdict("lcp", lcpVal);
    if (v !== "good")
      add(v, "cwv:lcp", `Largest Contentful Paint is slow (${(lcpVal / 1000).toFixed(1)}s, from ${src})`,
        "LCP is how long until the main content appears. Slow loads lose visitors and hurt ranking.",
        "Optimize the largest image/hero (compress, preload), reduce render-blocking CSS/JS, and use a CDN.");
  }
  if (hasData && inp != null) {
    const v = verdict("inp", inp);
    if (v !== "good")
      add(v, "cwv:inp", `Interaction delay is high (INP ${inp}ms, from real users)`,
        "INP measures how quickly the page responds to taps/clicks — a decisive ranking signal in 2026.",
        "Reduce heavy JavaScript and long tasks on the main thread.");
  }
  const clsVal = hasData ? cls : lab.cls;
  if (clsVal != null) {
    const v = verdict("cls", clsVal);
    if (v !== "good")
      add(v, "cwv:cls", `Layout shifts as it loads (CLS ${clsVal.toFixed(2)}, from ${src})`,
        "CLS measures content jumping around while loading — frustrating and penalized.",
        "Set explicit width/height on images and reserve space for ads/embeds.");
  }
  if (lab.performanceScore != null && lab.performanceScore < 50) {
    add("warning", "speed:score", `Low performance score (${lab.performanceScore}/100 in lab)`,
      "Overall the page is slow to load in testing.", "Work through the PageSpeed Insights opportunities for this URL.");
  }

  return { url, strategy, fetchedAt: new Date().toISOString(), lab, field, findings };
}
