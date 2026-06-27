import fs from "node:fs";
import path from "node:path";
import { siteDir } from "./config.js";
import { diagnoseSite, type Diagnosis, type Severity } from "./diagnose.js";

/**
 * Baseline snapshots: freeze a site's health on a given day so before/after is
 * provable. Each snapshot is the headline numbers + a compact finding list
 * derived from diagnoseSite(), stored under
 *   ~/.gsc-mcp/sites/<hash>/snapshots/<YYYY-MM-DD>.json
 * progress_report diffs two of them into a plain-English what-changed report.
 * See SPEC §8 (diagnose) — this is its longitudinal companion.
 */

/** One finding as frozen in a snapshot (compact — enough to match & explain). */
export interface SnapshotFinding {
  id: string;
  severity: Severity;
  title: string;
  count?: number;
}

export interface Snapshot {
  siteUrl: string;
  date: string; // UTC YYYY-MM-DD (the snapshot's filename key)
  capturedAt: string; // full ISO timestamp
  healthScore: number;
  grade: string;
  headline: string;
  metrics: Diagnosis["metrics"];
  issueCounts: {
    fixNow: number;
    worthImproving: number;
    looksScaryButFine: number;
    working: number;
  };
  /** The actionable findings (critical + warning), kept for diffing. */
  findings: SnapshotFinding[];
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function snapshotsDir(siteUrl: string): string {
  const dir = path.join(siteDir(siteUrl), "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function compactFinding(f: { id: string; severity: Severity; title: string; count?: number }): SnapshotFinding {
  return { id: f.id, severity: f.severity, title: f.title, count: f.count };
}

/**
 * Capture today's diagnosis as a snapshot and persist it. Overwrites any
 * existing snapshot for the same UTC day (a fresh read of "today"). Returns the
 * stored snapshot.
 */
export async function captureSnapshot(siteUrl: string): Promise<Snapshot> {
  const d = await diagnoseSite(siteUrl);
  const snapshot: Snapshot = {
    siteUrl,
    date: todayUTC(),
    capturedAt: new Date().toISOString(),
    healthScore: d.healthScore,
    grade: d.grade,
    headline: d.headline,
    metrics: d.metrics,
    issueCounts: {
      fixNow: d.triage.fixNow.length,
      worthImproving: d.triage.worthImproving.length,
      looksScaryButFine: d.triage.looksScaryButFine.length,
      working: d.triage.working.length,
    },
    findings: [...d.triage.fixNow, ...d.triage.worthImproving].map(compactFinding),
  };
  fs.writeFileSync(
    path.join(snapshotsDir(siteUrl), `${snapshot.date}.json`),
    JSON.stringify(snapshot, null, 2),
  );
  return snapshot;
}

/** Snapshot dates available for a site, oldest → newest. */
export function listSnapshotDates(siteUrl: string): string[] {
  const dir = path.join(siteDir(siteUrl), "snapshots");
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** Load one snapshot by its date key, or null if absent/unreadable. */
export function loadSnapshot(siteUrl: string, date: string): Snapshot | null {
  try {
    const raw = fs.readFileSync(path.join(siteDir(siteUrl), "snapshots", `${date}.json`), "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

export interface MetricDelta {
  from: number;
  to: number;
  change: number; // to - from
}

export interface ProgressReport {
  siteUrl: string;
  from: { date: string; capturedAt: string };
  to: { date: string; capturedAt: string };
  headline: string;
  healthScore: MetricDelta & { grade: { from: string; to: string } };
  metrics: {
    indexed: MetricDelta;
    notIndexed: MetricDelta;
    inspected: MetricDelta;
    clicks28d: MetricDelta;
    impressions28d: MetricDelta;
  };
  issues: {
    resolved: SnapshotFinding[]; // in baseline, gone now
    new: SnapshotFinding[]; // not in baseline, present now
    persisting: SnapshotFinding[]; // present in both (the "to" version)
  };
}

function delta(from: number, to: number): MetricDelta {
  return { from, to, change: to - from };
}

/**
 * Diff two snapshots into a progress report. `from` is the baseline (earlier),
 * `to` is the later snapshot. Findings are matched by their stable `id`.
 */
export function diffSnapshots(from: Snapshot, to: Snapshot): ProgressReport {
  const fromIds = new Set(from.findings.map((f) => f.id));
  const toIds = new Set(to.findings.map((f) => f.id));

  const resolved = from.findings.filter((f) => !toIds.has(f.id));
  const newly = to.findings.filter((f) => !fromIds.has(f.id));
  const persisting = to.findings.filter((f) => fromIds.has(f.id));

  const scoreChange = to.healthScore - from.healthScore;
  const indexedChange = to.metrics.indexed - from.metrics.indexed;
  const clicksChange = to.metrics.clicks28d - from.metrics.clicks28d;

  const parts: string[] = [];
  if (scoreChange !== 0) {
    parts.push(`Health ${scoreChange > 0 ? "up" : "down"} ${Math.abs(scoreChange)} pts (${from.healthScore}→${to.healthScore}, grade ${from.grade}→${to.grade})`);
  } else {
    parts.push(`Health unchanged at ${to.healthScore} (grade ${to.grade})`);
  }
  if (indexedChange !== 0) parts.push(`${indexedChange > 0 ? "+" : ""}${indexedChange} indexed pages`);
  if (resolved.length > 0) parts.push(`${resolved.length} issue${resolved.length > 1 ? "s" : ""} resolved`);
  if (newly.length > 0) parts.push(`${newly.length} new issue${newly.length > 1 ? "s" : ""}`);
  if (clicksChange !== 0) parts.push(`${clicksChange > 0 ? "+" : ""}${clicksChange} clicks (28d)`);

  const headline =
    parts.length > 1 || scoreChange !== 0 || resolved.length || newly.length || indexedChange
      ? parts.join("; ") + "."
      : `No measurable change between ${from.date} and ${to.date}.`;

  return {
    siteUrl: to.siteUrl,
    from: { date: from.date, capturedAt: from.capturedAt },
    to: { date: to.date, capturedAt: to.capturedAt },
    headline,
    healthScore: { ...delta(from.healthScore, to.healthScore), grade: { from: from.grade, to: to.grade } },
    metrics: {
      indexed: delta(from.metrics.indexed, to.metrics.indexed),
      notIndexed: delta(from.metrics.notIndexed, to.metrics.notIndexed),
      inspected: delta(from.metrics.inspected, to.metrics.inspected),
      clicks28d: delta(from.metrics.clicks28d, to.metrics.clicks28d),
      impressions28d: delta(from.metrics.impressions28d, to.metrics.impressions28d),
    },
    issues: { resolved, new: newly, persisting },
  };
}
