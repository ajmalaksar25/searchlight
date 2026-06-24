import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsToObjects, daysAgo, round } from "../dist/gsc.js";

test("rowsToObjects flattens keys and rounds ctr/position", () => {
  const out = rowsToObjects(
    ["query"],
    [{ keys: ["seo tools"], clicks: 5, impressions: 100, ctr: 0.05123, position: 7.38 }]
  );
  assert.deepEqual(out, [
    { query: "seo tools", clicks: 5, impressions: 100, ctr: 0.0512, position: 7.4 },
  ]);
});

test("rowsToObjects defaults missing metrics to zero", () => {
  const out = rowsToObjects(["page"], [{ keys: ["/a"] }]);
  assert.deepEqual(out[0], { page: "/a", clicks: 0, impressions: 0, ctr: 0, position: 0 });
});

test("daysAgo returns a YYYY-MM-DD string and is monotonic", () => {
  assert.match(daysAgo(0), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(daysAgo(2) < daysAgo(0));
});

test("round respects decimal places", () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(0.05123, 4), 0.0512);
});
