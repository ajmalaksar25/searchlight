import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml } from "../dist/audit.js";

test("analyzeHtml flags invalid JSON-LD, missing required props, and collects hreflang", () => {
  const html = `<html><head>
    <script type="application/ld+json">{ this is not valid json }</script>
    <script type="application/ld+json">{"@type":"Product","description":"a widget"}</script>
    <link rel="alternate" hreflang="fr" href="/fr">
    <link rel="alternate" hreflang="en" href="https://x.com/">
  </head><body><a href="/a">a</a></body></html>`;
  const sig = analyzeHtml(html, { url: "https://x.com/", status: 200 });
  assert.equal(sig.schemaInvalid, 1, "one unparseable JSON-LD block");
  assert.ok(sig.schemaIssues.some((s) => s.includes("Product") && s.includes("name")), "Product missing name flagged");
  assert.equal(sig.hreflang.length, 2);
  assert.equal(sig.hreflang[0].href, "https://x.com/fr", "hreflang href resolved to absolute");
});

test("analyzeHtml: complete schema produces no issues", () => {
  const html = `<script type="application/ld+json">{"@type":"Article","headline":"Hello"}</script>`;
  const sig = analyzeHtml(html, { url: "https://x.com/" });
  assert.equal(sig.schemaInvalid, 0);
  assert.deepEqual(sig.schemaIssues, []);
  assert.ok(sig.jsonLdTypes.includes("Article"));
});

test("analyzeHtml handles @graph arrays and array @type", () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":["WebSite"],"name":"S"},{"@type":"FAQPage"}]}</script>`;
  const sig = analyzeHtml(html, { url: "https://x.com/" });
  assert.ok(sig.jsonLdTypes.includes("WebSite") && sig.jsonLdTypes.includes("FAQPage"));
  assert.ok(sig.schemaIssues.some((s) => s.includes("FAQPage") && s.includes("mainEntity")), "FAQPage missing mainEntity flagged");
});
