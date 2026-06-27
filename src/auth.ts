import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import { google } from "googleapis";
import open from "open";
import { CONFIG_DIR, TOKEN_PATH } from "./config.js";
import { pagespeedApiKey } from "./keys.js";

/**
 * OAuth types are derived from `googleapis` itself rather than imported from
 * `google-auth-library`. Installing google-auth-library separately pulls a
 * second copy whose private fields differ from the one googleapis bundles,
 * which breaks assignment into `google.searchconsole({ auth })`.
 */
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
export type Credentials = Parameters<OAuth2Client["setCredentials"]>[0];

const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export function writeEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.GSC_ENABLE_WRITE || "");
}

/** Setup/provisioning mode — registers the tools that create GA4/GTM/verification. */
export function setupEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.GSC_ENABLE_SETUP || "");
}

/** Analytics is included by default (one login = GSC + GA). Opt out with GSC_DISABLE_ANALYTICS. */
function analyticsEnabled(): boolean {
  return !/^(1|true|yes|on)$/i.test(process.env.GSC_DISABLE_ANALYTICS || "");
}

// Tier-2 setup scopes (only requested when GSC_ENABLE_SETUP is on). Least
// privilege: no tagmanager.manage.users / delete.containers.
const SETUP_SCOPES = [
  "https://www.googleapis.com/auth/siteverification",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.manage.accounts",
  "https://www.googleapis.com/auth/tagmanager.publish",
];

export function scopes(): string[] {
  // Setup mode needs Search Console write (sites.add, sitemap submit) too.
  const s = [writeEnabled() || setupEnabled() ? WRITE_SCOPE : READONLY_SCOPE];
  if (analyticsEnabled()) s.push(ANALYTICS_SCOPE);
  if (setupEnabled()) s.push(...SETUP_SCOPES);
  return s;
}

export function hasToken(): boolean {
  return fs.existsSync(TOKEN_PATH);
}

/** Scopes actually granted in the stored token (its space-separated `scope` field). */
export function grantedScopes(): string[] {
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    return typeof t.scope === "string" ? t.scope.split(/\s+/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function pageSpeedKeySet(): boolean {
  return Boolean(pagespeedApiKey());
}

interface ClientCreds {
  clientId: string;
  clientSecret: string;
}

/**
 * Read the bundled Tier-1 client shipped with the package (gitignored in source,
 * included in the npm tarball). Lives at the package root, one level above dist/.
 */
function readBundledClientFile(): ClientCreds | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(new URL("../bundled-client.json", import.meta.url), "utf8")
    );
    const block = raw.installed || raw.web || raw;
    if (block?.client_id && block?.client_secret) {
      return { clientId: block.client_id, clientSecret: block.client_secret };
    }
  } catch {
    /* no bundled client present */
  }
  return null;
}

/**
 * Resolve the OAuth client credentials (Tier 0 bring-your-own, Tier 1 bundled).
 * Precedence (see SPEC §5.5/§5.6):
 *   1. GSC_OAUTH_CLIENT_ID + GSC_OAUTH_CLIENT_SECRET
 *   2. GSC_OAUTH_CREDENTIALS = path to client_secret.json (installed|web block)
 *   3. bundled Tier-1 client: GSC_BUNDLED_CLIENT_ID/SECRET, then bundled-client.json
 */
function loadClientCredentials(): ClientCreds {
  const id = process.env.GSC_OAUTH_CLIENT_ID;
  const secret = process.env.GSC_OAUTH_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };

  const credPath = process.env.GSC_OAUTH_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
    const block = raw.installed || raw.web || raw;
    if (block?.client_id && block?.client_secret) {
      return { clientId: block.client_id, clientSecret: block.client_secret };
    }
  }

  const bundledId = process.env.GSC_BUNDLED_CLIENT_ID;
  const bundledSecret = process.env.GSC_BUNDLED_CLIENT_SECRET;
  if (bundledId && bundledSecret) return { clientId: bundledId, clientSecret: bundledSecret };

  const bundledFile = readBundledClientFile();
  if (bundledFile) return bundledFile;

  throw new Error(
    "Missing OAuth client credentials. Set GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET, " +
      "or set GSC_OAUTH_CREDENTIALS to the path of the client_secret JSON downloaded from Google Cloud."
  );
}

/** True if a client config is available without throwing (drives setupState). */
export function clientAvailable(): boolean {
  try {
    loadClientCredentials();
    return true;
  } catch {
    return false;
  }
}

function newOAuthClient(redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = loadClientCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function saveToken(tokens: Credentials): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  let existing: Credentials = {};
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    } catch {
      /* corrupt file, overwrite */
    }
  }
  // Refresh responses often omit refresh_token; keep the original.
  const merged = { ...existing, ...tokens };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

/** Returns an authorized OAuth2 client that auto-refreshes and persists tokens. */
export async function getAuthClient(): Promise<OAuth2Client> {
  if (!hasToken()) {
    throw new Error(
      "Not authenticated. Run `gsc-mcp login`, or ask me to log you in (the auth_login tool)."
    );
  }
  const client = newOAuthClient();
  const tokens: Credentials = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  client.setCredentials(tokens);
  client.on("tokens", (t) => saveToken(t));
  return client;
}

export interface LoginResult {
  ok: true;
  tokenPath: string;
  scope: string;
  refreshToken: boolean;
  warning?: string;
}

/**
 * Interactive browser login using a localhost loopback redirect.
 * Shared by the CLI `login` command and the in-conversation `auth_login` tool.
 * Logs go to stderr only (stdout is the MCP channel). Returns a summary.
 */
export async function login(): Promise<LoginResult> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const client = newOAuthClient(redirectUri);

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes(),
  });

  const codePromise = new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      try {
        const u = new URL(req.url ?? "/", redirectUri);
        if (u.pathname !== "/callback") {
          res.statusCode = 404;
          res.end();
          return;
        }
        const code = u.searchParams.get("code");
        const err = u.searchParams.get("error");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (err || !code) {
          res.end(`<h2>Authorization failed: ${err ?? "no code"}</h2><p>You can close this tab.</p>`);
          reject(new Error(err ?? "No authorization code returned"));
          return;
        }
        res.end("<h2>gsc-mcp connected &#10003;</h2><p>You can close this tab.</p>");
        resolve(code);
      } catch (e) {
        reject(e as Error);
      }
    });
  });

  console.error("\nOpening your browser for Google sign-in...");
  console.error("If it does not open, paste this URL into your browser:\n");
  console.error(authUrl + "\n");
  try {
    await open(authUrl);
  } catch {
    /* URL already printed above */
  }

  const code = await codePromise;
  const { tokens } = await client.getToken(code);
  saveToken(tokens);
  server.close();

  const warning = tokens.refresh_token
    ? undefined
    : "Google did not return a refresh token. Remove this app's access at " +
      "https://myaccount.google.com/permissions and log in again.";
  if (warning) console.error("\nWarning: " + warning);
  console.error(`\n✓ Authenticated. Token stored at ${TOKEN_PATH}`);
  console.error(`  Scopes granted (${scopes().length}): ${scopes().map((s) => s.split("/auth/")[1]).join(", ")}`);

  return {
    ok: true,
    tokenPath: TOKEN_PATH,
    scope: scopes()[0],
    refreshToken: Boolean(tokens.refresh_token),
    warning,
  };
}

export function logout(): void {
  if (fs.existsSync(TOKEN_PATH)) fs.rmSync(TOKEN_PATH);
}

export type SetupState =
  | "needs_oauth_client"
  | "needs_login"
  | "needs_pagespeed_key"
  | "ready";

/** Where the user is in onboarding, plus a one-line next step. */
export function setupState(): { state: SetupState; nextStep: string } {
  if (!clientAvailable()) {
    return {
      state: "needs_oauth_client",
      nextStep:
        "Set GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET (or GSC_OAUTH_CREDENTIALS). " +
        "Run `gsc-mcp setup` for a guided walkthrough.",
    };
  }
  if (!hasToken()) {
    return {
      state: "needs_login",
      nextStep: "Sign in: run `gsc-mcp login`, or ask me to log you in (auth_login).",
    };
  }
  if (!pageSpeedKeySet()) {
    return {
      state: "needs_pagespeed_key",
      nextStep:
        "Optional: set GSC_PAGESPEED_API_KEY to enable page-speed / Core Web Vitals tools.",
    };
  }
  return { state: "ready", nextStep: "All set." };
}

export { TOKEN_PATH, CONFIG_DIR };
