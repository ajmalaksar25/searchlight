import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Filesystem layout and the property registry.
 *
 * Everything the server persists lives under CONFIG_DIR (default ~/.gsc-mcp,
 * override with GSC_MCP_HOME):
 *
 *   ~/.gsc-mcp/
 *     token.json          OAuth tokens (mode 0600)
 *     config.json         property registry + default site (this file)
 *     sites/<hash>/...     per-site cache, coverage, reports (added in later phases)
 */
export const CONFIG_DIR =
  process.env.GSC_MCP_HOME || path.join(os.homedir(), ".gsc-mcp");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const SITES_DIR = path.join(CONFIG_DIR, "sites");

export interface SiteAlias {
  alias: string;
  siteUrl: string;
}

export interface ConfigFile {
  /** Property used when a tool call omits siteUrl and no session site is set. */
  defaultSite?: string;
  /** Friendly aliases so users can say "blog" instead of pasting a property URL. */
  sites: SiteAlias[];
}

const EMPTY: ConfigFile = { sites: [] };

export function loadConfig(): ConfigFile {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { defaultSite: raw.defaultSite, sites: Array.isArray(raw.sites) ? raw.sites : [] };
  } catch {
    return { ...EMPTY };
  }
}

export function saveConfig(cfg: ConfigFile): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** The persisted default site: config.json wins, else the GSC_DEFAULT_SITE env var. */
export function defaultSite(cfg = loadConfig()): string | undefined {
  return cfg.defaultSite || process.env.GSC_DEFAULT_SITE || undefined;
}

/** Resolve a user-supplied token that may be an alias or a raw property URL. */
export function resolveAlias(input: string, cfg = loadConfig()): string {
  const hit = cfg.sites.find((s) => s.alias.toLowerCase() === input.toLowerCase());
  return hit ? hit.siteUrl : input;
}

export function addAlias(alias: string, siteUrl: string): ConfigFile {
  const cfg = loadConfig();
  const others = cfg.sites.filter((s) => s.alias.toLowerCase() !== alias.toLowerCase());
  cfg.sites = [...others, { alias, siteUrl }];
  saveConfig(cfg);
  return cfg;
}

export function removeAlias(alias: string): ConfigFile {
  const cfg = loadConfig();
  cfg.sites = cfg.sites.filter((s) => s.alias.toLowerCase() !== alias.toLowerCase());
  saveConfig(cfg);
  return cfg;
}

export function setDefaultSite(site: string): ConfigFile {
  const cfg = loadConfig();
  cfg.defaultSite = resolveAlias(site, cfg);
  saveConfig(cfg);
  return cfg;
}

/** Per-site cache directory (stable hash of the property URL). Created on demand. */
export function siteDir(siteUrl: string): string {
  // Lightweight, dependency-free stable hash — good enough to namespace folders.
  let h = 0;
  for (let i = 0; i < siteUrl.length; i++) {
    h = (Math.imul(31, h) + siteUrl.charCodeAt(i)) | 0;
  }
  const slug = (h >>> 0).toString(16).padStart(8, "0");
  return path.join(SITES_DIR, slug);
}
