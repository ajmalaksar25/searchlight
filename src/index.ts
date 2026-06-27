#!/usr/bin/env node
import { login, logout, hasToken, TOKEN_PATH, scopes, grantedScopes, setupState } from "./auth.js";
import { startServer } from "./server.js";
import {
  loadConfig,
  defaultSite,
  addAlias,
  removeAlias,
  setDefaultSite,
  resolveAlias,
} from "./config.js";
import { gscClient } from "./gsc.js";
import { refreshCoverage } from "./coverage.js";

const USAGE = `gsc-mcp - Google Search Console SEO copilot (MCP server)

Usage:
  gsc-mcp login            Sign in with Google (opens a browser)
  gsc-mcp logout           Remove the stored token
  gsc-mcp status           Show authentication + onboarding status
  gsc-mcp setup            Guided first-run: what to set up next
  gsc-mcp sites            Manage the property registry:
                             sites list
                             sites add <alias> <siteUrl>
                             sites remove <alias>
                             sites default <alias|siteUrl>
  gsc-mcp crawl            Crawl coverage headlessly (schedulable):
                             crawl <alias|siteUrl> [--max N]
                             crawl --all [--max N]
  gsc-mcp serve            Start the MCP server over stdio (default)

Flags (no env vars needed — pass these in your MCP client's args, e.g.
["serve", "--setup"], and use the same flag when running \`login\`):
  --setup          Enable setup mode (GA4 / GTM / verification provisioning)
  --write          Enable Search Console write tools (sitemap submit/delete)
  --no-analytics   Don't request the Google Analytics scope

Add it to an MCP client by running \`gsc-mcp serve\` (or just \`gsc-mcp\`).`;

function scopeSummary(): string {
  const granted = grantedScopes();
  const list = granted.length ? granted : scopes();
  const names = list.map((s) => s.split("/auth/")[1] ?? s).join(", ");
  return `${list.length} ${granted.length ? "granted" : "configured"} (${names})`;
}

function printStatus(): void {
  const { state, nextStep } = setupState();
  const lines = [
    hasToken() ? "Authenticated." : "Not authenticated.",
    `  Token:    ${TOKEN_PATH}`,
    `  Scopes:   ${scopeSummary()}`,
    `  Default:  ${defaultSite() ?? "(none)"}`,
    `  Setup:    ${state} — ${nextStep}`,
  ];
  console.error(lines.join("\n"));
}

function printSetup(): void {
  const { state, nextStep } = setupState();
  console.error(`Setup state: ${state}\nNext: ${nextStep}\n`);
  if (state === "needs_oauth_client") {
    console.error(
      [
        "One-time Google Cloud setup (Tier 0 / bring-your-own):",
        "  1. Create or pick a project at https://console.cloud.google.com/",
        "  2. Enable the Google Search Console API (and PageSpeed Insights API).",
        "  3. OAuth consent screen: External, add yourself as a test user.",
        "  4. Create an OAuth client ID of type 'Desktop app'.",
        "  5. Set GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET (or GSC_OAUTH_CREDENTIALS).",
        "Then run `gsc-mcp login`.",
      ].join("\n")
    );
  }
}

function manageSites(args: string[]): void {
  const sub = args[0];
  const cfg = loadConfig();
  switch (sub) {
    case undefined:
    case "list": {
      console.error(`Default: ${defaultSite(cfg) ?? "(none)"}`);
      if (!cfg.sites.length) {
        console.error("No aliases registered. Add one: gsc-mcp sites add <alias> <siteUrl>");
        return;
      }
      for (const s of cfg.sites) console.error(`  ${s.alias} -> ${s.siteUrl}`);
      return;
    }
    case "add": {
      const [alias, siteUrl] = [args[1], args[2]];
      if (!alias || !siteUrl) throw new Error("Usage: gsc-mcp sites add <alias> <siteUrl>");
      addAlias(alias, siteUrl);
      console.error(`Added alias ${alias} -> ${siteUrl}`);
      return;
    }
    case "remove": {
      const alias = args[1];
      if (!alias) throw new Error("Usage: gsc-mcp sites remove <alias>");
      removeAlias(alias);
      console.error(`Removed alias ${alias}`);
      return;
    }
    case "default": {
      const site = args[1];
      if (!site) throw new Error("Usage: gsc-mcp sites default <alias|siteUrl>");
      const next = setDefaultSite(site);
      console.error(`Default site set to ${next.defaultSite}`);
      return;
    }
    default:
      throw new Error(`Unknown sites subcommand: ${sub}\n\n${USAGE}`);
  }
}

async function crawl(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const maxIdx = args.indexOf("--max");
  const max = maxIdx >= 0 ? Math.max(1, parseInt(args[maxIdx + 1] ?? "100", 10) || 100) : 100;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max") {
      i++;
      continue;
    }
    if (args[i] === "--all") continue;
    positional.push(args[i]);
  }

  let sites: string[];
  if (all) {
    const gsc = await gscClient();
    const res = await gsc.sites.list();
    sites = (res.data.siteEntry ?? []).map((s) => s.siteUrl).filter((u): u is string => Boolean(u));
  } else {
    const target = positional[0];
    if (!target) {
      throw new Error("Usage: gsc-mcp crawl <alias|siteUrl> [--max N]  |  gsc-mcp crawl --all [--max N]");
    }
    sites = [resolveAlias(target)];
  }

  for (const siteUrl of sites) {
    console.error(`\nCrawling ${siteUrl} (max ${max})...`);
    try {
      const p = await refreshCoverage(siteUrl, max);
      console.error(
        `  inspected ${p.inspectedThisRun}, errors ${p.errors}, pending ${p.pendingAfter}, quota ${p.quotaUsedToday}/${p.quotaPerDay}`
      );
      console.error(`  ${p.note}`);
    } catch (e) {
      console.error(`  Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Parse global flags (an easier alternative to env vars — usable in an MCP
 * client's args array, e.g. ["serve", "--setup"]) and apply them by setting the
 * matching env var, then return argv with those flags removed.
 */
function applyGlobalFlags(argv: string[]): string[] {
  const rest: string[] = [];
  for (const a of argv) {
    switch (a) {
      case "--setup":
      case "--enable-setup":
        process.env.GSC_ENABLE_SETUP = "1";
        break;
      case "--write":
      case "--enable-write":
        process.env.GSC_ENABLE_WRITE = "1";
        break;
      case "--no-analytics":
        process.env.GSC_DISABLE_ANALYTICS = "1";
        break;
      default:
        rest.push(a);
    }
  }
  return rest;
}

async function main(): Promise<void> {
  const argv = applyGlobalFlags(process.argv.slice(2));
  const cmd = argv[0];
  switch (cmd) {
    case "login":
      await login();
      break;
    case "logout":
      logout();
      console.error("Logged out. Token removed.");
      break;
    case "status":
      printStatus();
      break;
    case "setup":
      printSetup();
      break;
    case "sites":
      manageSites(argv.slice(1));
      break;
    case "crawl":
      await crawl(argv.slice(1));
      break;
    case "-h":
    case "--help":
    case "help":
      console.error(USAGE);
      break;
    case undefined:
    case "serve":
      await startServer();
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
