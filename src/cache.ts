import fs from "node:fs";
import path from "node:path";
import { siteDir } from "./config.js";

/**
 * Generic per-site cache IO + a daily quota ledger.
 *
 * Each property gets a folder under ~/.searchlight/sites/<hash>/ holding small JSON
 * files (candidates.json, coverage.json, quota.json, meta.json). The coverage
 * crawler (coverage.ts) is the main client.
 */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readSiteJson<T>(siteUrl: string, file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(siteDir(siteUrl), file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeSiteJson(siteUrl: string, file: string, data: unknown): void {
  const dir = siteDir(siteUrl);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** URL Inspection calls used today for this property (resets at UTC midnight). */
export function quotaUsedToday(siteUrl: string): number {
  const q = readSiteJson<Record<string, number>>(siteUrl, "quota.json", {});
  return q[todayUTC()] ?? 0;
}

/** Record `n` URL Inspection calls against today's per-property quota. */
export function addQuota(siteUrl: string, n: number): void {
  const q = readSiteJson<Record<string, number>>(siteUrl, "quota.json", {});
  const day = todayUTC();
  q[day] = (q[day] ?? 0) + n;
  // keep the ledger small: drop entries older than ~10 days
  for (const k of Object.keys(q)) {
    if (k < day && Date.parse(day) - Date.parse(k) > 10 * 86400000) delete q[k];
  }
  writeSiteJson(siteUrl, "quota.json", q);
}
