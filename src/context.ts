import { searchconsole_v1 } from "googleapis";
import { gscClient } from "./gsc.js";
import { defaultSite, resolveAlias, loadConfig } from "./config.js";

export type SiteSource = "arg" | "session" | "default";

export interface ResolvedSite {
  siteUrl: string;
  source: SiteSource;
}

/**
 * Per-connection state and shared services handed to every tool module.
 *
 * A fresh ToolContext is created per `buildServer()` call. Because the server
 * runs over stdio (one long-lived process per client connection), the in-memory
 * `activeSite` is naturally scoped to this connection — we keep it as our own
 * state with a config.json fallback rather than relying on protocol sessions.
 */
export class ToolContext {
  /** Session active site (set via the use_site tool). Resolved siteUrl. */
  private activeSite: string | undefined;

  gsc(): Promise<searchconsole_v1.Searchconsole> {
    return gscClient();
  }

  setActiveSite(input: string): string {
    const siteUrl = resolveAlias(input);
    this.activeSite = siteUrl;
    return siteUrl;
  }

  getActiveSite(): string | undefined {
    return this.activeSite;
  }

  /**
   * Resolve the property a tool should act on.
   * Order: explicit arg (alias-aware) → session active site → persisted default.
   * Throws a clear, registry-listing error when nothing resolves.
   */
  resolveSite(input?: string): ResolvedSite {
    if (input && input.trim()) {
      return { siteUrl: resolveAlias(input.trim()), source: "arg" };
    }
    if (this.activeSite) {
      return { siteUrl: this.activeSite, source: "session" };
    }
    const def = defaultSite();
    if (def) {
      return { siteUrl: def, source: "default" };
    }
    const cfg = loadConfig();
    const known = cfg.sites.length
      ? ` Known aliases: ${cfg.sites.map((s) => s.alias).join(", ")}.`
      : "";
    throw new Error(
      "No site specified and no active/default site set. Pass siteUrl, " +
        `or call use_site / set_default_site first.${known}`
    );
  }
}
