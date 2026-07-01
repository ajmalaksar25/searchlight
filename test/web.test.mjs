import { test } from "node:test";
import assert from "node:assert/strict";
import { robotsMatchLen, robotsBlocks, normKey, extractLocs } from "../dist/util/web.js";

test("robotsMatchLen handles wildcards and anchors (the /*.pdf trap)", () => {
  assert.ok(robotsMatchLen("/a/b.pdf", "/*.pdf") >= 0, "/*.pdf should match a .pdf path");
  assert.equal(robotsMatchLen("/page", "/*.pdf"), -1, "/*.pdf must NOT match a non-pdf path");
  assert.ok(robotsMatchLen("/p?x=1", "/*?") >= 0, "/*? matches a param URL");
  assert.equal(robotsMatchLen("/p", "/*?"), -1, "/*? must NOT match a param-less URL");
  assert.ok(robotsMatchLen("/x.pdf", "/*.pdf$") >= 0, "trailing $ matches when path ends with .pdf");
  assert.equal(robotsMatchLen("/x.pdf?y", "/*.pdf$"), -1, "trailing $ anchors to end");
  assert.equal(robotsMatchLen("/anything", "/"), 1, "'/' matches everything (specificity 1)");
});

test("robotsBlocks: leading-wildcard rule does NOT block the whole site", () => {
  // This was the bug: '/*.pdf' collapsed to '/' and blocked every URL.
  assert.equal(robotsBlocks("/blog/post", ["/*.pdf"]), false);
  assert.equal(robotsBlocks("/whitepaper.pdf", ["/*.pdf"]), true);
});

test("robotsBlocks: Allow wins over a less-or-equally specific Disallow", () => {
  assert.equal(robotsBlocks("/public/x", ["/"], ["/public/"]), false, "/public allowed under Disallow: /");
  assert.equal(robotsBlocks("/private/x", ["/"], ["/public/"]), true, "/private still blocked");
  assert.equal(robotsBlocks("/anything", [], []), false, "no disallow => allowed");
});

test("normKey normalizes host + trailing slash + fragment, keeps query", () => {
  assert.equal(normKey("https://Example.com/a/"), "https://example.com/a");
  assert.equal(normKey("https://example.com/a#frag"), "https://example.com/a");
  assert.equal(normKey("https://example.com/"), "https://example.com/", "root slash kept");
  assert.equal(normKey("https://example.com/a?b=1"), "https://example.com/a?b=1", "query kept");
  assert.equal(normKey("/rel", "https://example.com/base"), "https://example.com/rel", "resolves relative");
});

test("extractLocs pulls and decodes sitemap <loc> URLs", () => {
  const xml = "<urlset><url><loc>https://x.com/a?p=1&amp;q=2</loc></url><url><loc>https://x.com/b</loc></url></urlset>";
  assert.deepEqual(extractLocs(xml), ["https://x.com/a?p=1&q=2", "https://x.com/b"]);
});
