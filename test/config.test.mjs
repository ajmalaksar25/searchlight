import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlias, defaultSite, siteDir } from "../dist/config.js";

const cfg = {
  defaultSite: undefined,
  sites: [
    { alias: "blog", siteUrl: "sc-domain:example.com" },
    { alias: "shop", siteUrl: "https://shop.example.com/" },
  ],
};

test("resolveAlias maps a known alias to its property", () => {
  assert.equal(resolveAlias("blog", cfg), "sc-domain:example.com");
});

test("resolveAlias is case-insensitive", () => {
  assert.equal(resolveAlias("BLOG", cfg), "sc-domain:example.com");
});

test("resolveAlias passes through a non-alias unchanged", () => {
  assert.equal(resolveAlias("https://other.example/", cfg), "https://other.example/");
});

test("defaultSite prefers config over nothing", () => {
  assert.equal(defaultSite({ defaultSite: "sc-domain:a.com", sites: [] }), "sc-domain:a.com");
});

test("siteDir is stable and namespaced per property", () => {
  assert.equal(siteDir("sc-domain:example.com"), siteDir("sc-domain:example.com"));
  assert.notEqual(siteDir("sc-domain:example.com"), siteDir("https://shop.example.com/"));
});
