#!/usr/bin/env node
import { login, logout, hasToken, TOKEN_PATH, scopes, setupState } from "./auth.js";
import { startServer } from "./server.js";
import {
  loadConfig,
  defaultSite,
  addAlias,
  removeAlias,
  setDefaultSite,
} from "./config.js";

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
  gsc-mcp serve            Start the MCP server over stdio (default)

Add it to an MCP client by running \`gsc-mcp serve\` (or just \`gsc-mcp\`).`;

function printStatus(): void {
  const { state, nextStep } = setupState();
  const lines = [
    hasToken() ? "Authenticated." : "Not authenticated.",
    `  Token:    ${TOKEN_PATH}`,
    `  Scope:    ${scopes()[0]}`,
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

async function main(): Promise<void> {
  const cmd = process.argv[2];
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
      manageSites(process.argv.slice(3));
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
