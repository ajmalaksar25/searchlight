import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeepLink } from "../dist/deeplinks.js";

test("removals link targets the removals report with an encoded resource id", () => {
  const url = buildDeepLink("sc-domain:example.com", "removals");
  assert.match(url, /\/removals\?/);
  assert.match(url, /resource_id=sc-domain%3Aexample\.com/);
});

test("pageIndexing maps to the /index report", () => {
  assert.match(buildDeepLink("https://example.com/", "pageIndexing"), /search-console\/index\?/);
});

test("overview has no sub-path", () => {
  const url = buildDeepLink("https://example.com/", "overview");
  assert.match(url, /search-console\?resource_id=/);
  assert.doesNotMatch(url, /search-console\/[a-z]/);
});
