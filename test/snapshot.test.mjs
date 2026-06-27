import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "../dist/snapshot.js";

/** Minimal snapshot factory so each test states only what it cares about. */
function snap(overrides = {}) {
  return {
    siteUrl: "sc-domain:example.com",
    date: "2026-01-01",
    capturedAt: "2026-01-01T00:00:00.000Z",
    healthScore: 50,
    grade: "C",
    headline: "",
    metrics: { indexed: 0, notIndexed: 0, inspected: 0, knownUrls: 0, clicks28d: 0, impressions28d: 0, topQueries: [] },
    issueCounts: { fixNow: 0, worthImproving: 0, looksScaryButFine: 0, working: 0 },
    findings: [],
    ...overrides,
  };
}

test("diffSnapshots reports resolved, new, and persisting issues by id", () => {
  const from = snap({
    findings: [
      { id: "robots:example.com", severity: "critical", title: "robots broken" },
      { id: "sitemap:unreadable", severity: "warning", title: "sitemap redirects" },
    ],
  });
  const to = snap({
    date: "2026-02-01",
    capturedAt: "2026-02-01T00:00:00.000Z",
    findings: [
      { id: "sitemap:unreadable", severity: "warning", title: "sitemap redirects" },
      { id: "coverage:Crawled - currently not indexed", severity: "warning", title: "1 page thin" },
    ],
  });

  const r = diffSnapshots(from, to);
  assert.deepEqual(r.issues.resolved.map((f) => f.id), ["robots:example.com"]);
  assert.deepEqual(r.issues.new.map((f) => f.id), ["coverage:Crawled - currently not indexed"]);
  assert.deepEqual(r.issues.persisting.map((f) => f.id), ["sitemap:unreadable"]);
});

test("diffSnapshots computes metric deltas and a health change", () => {
  const from = snap({ healthScore: 40, grade: "D", metrics: { ...snap().metrics, indexed: 2, clicks28d: 5 } });
  const to = snap({ date: "2026-03-01", healthScore: 72, grade: "B", metrics: { ...snap().metrics, indexed: 9, clicks28d: 20 } });

  const r = diffSnapshots(from, to);
  assert.equal(r.healthScore.change, 32);
  assert.deepEqual(r.healthScore.grade, { from: "D", to: "B" });
  assert.equal(r.metrics.indexed.change, 7);
  assert.equal(r.metrics.clicks28d.change, 15);
  assert.match(r.headline, /Health up 32 pts/);
});

test("diffSnapshots headline is honest when nothing changed", () => {
  const r = diffSnapshots(snap(), snap({ date: "2026-02-01" }));
  assert.match(r.headline, /No measurable change/);
});
