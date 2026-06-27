import { z } from "zod";
import { ok, fail } from "../util/result.js";
import {
  captureSnapshot,
  listSnapshotDates,
  loadSnapshot,
  diffSnapshots,
} from "../snapshot.js";
import { siteUrlOptional, type ToolModule } from "./shared.js";

/**
 * Baseline snapshots + progress reports. Capture freezes today's health so a
 * later run can prove before→after. progress_report diffs two snapshots into a
 * plain-English what-changed report. Backed by src/snapshot.ts.
 */
export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "snapshot_baseline",
    {
      title: "Freeze a baseline snapshot of site health",
      description:
        "Capture today's diagnosis (health score, indexed counts, 28-day traffic, and the actionable issue list) " +
        "as a dated snapshot under the local cache. Run this BEFORE making changes so you have a baseline, then " +
        "again later — use progress_report to prove what improved. Re-running on the same day overwrites that " +
        "day's snapshot. Run refresh_coverage first for the fullest picture.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const snap = await captureSnapshot(resolved);
        return ok({
          saved: `${snap.date}.json`,
          snapshot: snap,
          hint: "Baseline saved. Make your fixes, then run snapshot_baseline again and progress_report to see the delta.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_snapshots",
    {
      title: "List saved baseline snapshots",
      description:
        "List the dates (oldest→newest) for which a baseline snapshot exists for this property, so you can pick " +
        "two to diff with progress_report.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const dates = listSnapshotDates(resolved);
        return ok({
          siteUrl: resolved,
          count: dates.length,
          dates,
          hint:
            dates.length === 0
              ? "No snapshots yet. Run snapshot_baseline to capture one."
              : dates.length === 1
                ? "Only one snapshot — capture another after making changes, then run progress_report."
                : "Run progress_report to diff the oldest and newest (or pass specific from/to dates).",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "progress_report",
    {
      title: "Progress report (diff two baseline snapshots)",
      description:
        "Compare two baseline snapshots and report what changed: health-score and grade movement, indexed/traffic " +
        "deltas, and which issues were RESOLVED, which are NEW, and which PERSIST. Defaults to oldest→newest; pass " +
        "from/to (YYYY-MM-DD, from list_snapshots) to compare specific days. This is how before→after is proven.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        from: z
          .string()
          .optional()
          .describe("Baseline date (YYYY-MM-DD). Defaults to the OLDEST snapshot."),
        to: z
          .string()
          .optional()
          .describe("Later date (YYYY-MM-DD) to compare against the baseline. Defaults to the NEWEST snapshot."),
      },
    },
    async ({ siteUrl, from, to }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const dates = listSnapshotDates(resolved);
        if (dates.length < 2 && !(from && to)) {
          return ok({
            siteUrl: resolved,
            hint: `Need at least two snapshots to compare (have ${dates.length}). Run snapshot_baseline now and again later, then re-run progress_report.`,
            dates,
          });
        }
        const fromDate = from ?? dates[0];
        const toDate = to ?? dates[dates.length - 1];
        if (fromDate === toDate) {
          return fail(new Error(`from and to are the same date (${fromDate}). Pick two different snapshots.`));
        }
        const fromSnap = loadSnapshot(resolved, fromDate);
        const toSnap = loadSnapshot(resolved, toDate);
        if (!fromSnap) return fail(new Error(`No snapshot found for ${fromDate}. Available: ${dates.join(", ") || "none"}.`));
        if (!toSnap) return fail(new Error(`No snapshot found for ${toDate}. Available: ${dates.join(", ") || "none"}.`));
        return ok(diffSnapshots(fromSnap, toSnap));
      } catch (e) {
        return fail(e);
      }
    },
  );
};
