import { ok, fail } from "../util/result.js";
import {
  hasToken,
  scopes,
  grantedScopes,
  writeEnabled,
  setupEnabled,
  pageSpeedKeySet,
  setupState,
  login,
  TOKEN_PATH,
} from "../auth.js";
import { defaultSite } from "../config.js";
import type { ToolModule } from "./shared.js";

export const register: ToolModule = (server, ctx) => {
  server.registerTool(
    "auth_status",
    {
      title: "Auth status",
      description:
        "Check whether the server is authenticated to Google Search Console, which scope is active, " +
        "and where you are in onboarding (setupState). Call this first if other tools report an auth error.",
      inputSchema: {},
    },
    async () => {
      const authed = hasToken();
      const { state, nextStep } = setupState();
      return ok({
        authenticated: authed,
        scopes: grantedScopes().length ? grantedScopes() : scopes(),
        writeEnabled: writeEnabled(),
        setupMode: setupEnabled(),
        tokenPath: TOKEN_PATH,
        activeSite: ctx.getActiveSite() ?? null,
        defaultSite: defaultSite() ?? null,
        pageSpeedKeySet: pageSpeedKeySet(),
        setupState: state,
        nextStep,
        hint: authed ? undefined : nextStep,
      });
    }
  );

  server.registerTool(
    "auth_login",
    {
      title: "Log in to Google Search Console",
      description:
        "Sign in to Google in the browser, right from here — no terminal needed. Opens the consent " +
        "screen, captures the token on a localhost callback, and stores it. Use when auth_status says needs_login.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await login();
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    }
  );
};
