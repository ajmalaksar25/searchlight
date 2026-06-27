import { z } from "zod";
import { ok, fail } from "../util/result.js";
import { setupEnabled } from "../auth.js";
import { listProperties, gaErrorMessage } from "../ga.js";
import {
  listGaAccounts,
  createGa4Property,
  getVerificationToken,
  verifySite,
  listGtmAccounts,
  createGtmContainer,
} from "../provision.js";
import { siteUrlOptional, SITE_URL_DESC, type ToolModule } from "./shared.js";

function siteToHttps(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return `https://${siteUrl.slice("sc-domain:".length)}/`;
  return siteUrl;
}

function siteDomain(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length).toLowerCase();
  try {
    return new URL(siteUrl).host.toLowerCase();
  } catch {
    return siteUrl.toLowerCase();
  }
}

export const register: ToolModule = (server, ctx) => {
  // Always available (read-only): what's set up and what's missing.
  server.registerTool(
    "setup_status",
    {
      title: "Setup status (what's configured, what's missing)",
      description:
        "For a property, report what's already set up and what's missing — Search Console ownership, a matching " +
        "GA4 property, and whether a sitemap is submitted — plus the gaps and next actions. Drives the /seo-setup " +
        "flow. Read-only.",
      inputSchema: { siteUrl: siteUrlOptional },
    },
    async ({ siteUrl }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        const domain = siteDomain(resolved);
        const gaps: string[] = [];

        // GSC ownership: present in list_sites => owned/verified.
        const gsc = await ctx.gsc();
        const sites = await gsc.sites.list();
        const gscVerified = (sites.data.siteEntry ?? []).some((s) => s.siteUrl === resolved);
        if (!gscVerified) gaps.push("Site not verified in Search Console — add + verify it.");

        // GA4 property match (best-effort; needs analytics connected).
        let ga4: { propertyId: string; displayName: string } | null = null;
        let gaConnected = true;
        try {
          const props = await listProperties();
          const hit = props.find((p) => p.urls.some((u) => siteDomain(u) === domain || siteDomain(u).endsWith("." + domain)));
          if (hit) ga4 = { propertyId: hit.propertyId, displayName: hit.displayName };
        } catch (e) {
          gaConnected = false;
          void gaErrorMessage(e);
        }
        if (gaConnected && !ga4) gaps.push("No GA4 property found for this site — create one + install the tag.");
        if (!gaConnected) gaps.push("Analytics not connected — enable the Analytics APIs and re-login with analytics scope.");

        // Sitemap submitted?
        let sitemapSubmitted = false;
        try {
          const sm = await gsc.sitemaps.list({ siteUrl: resolved });
          sitemapSubmitted = (sm.data.sitemap ?? []).length > 0;
        } catch {
          /* ignore */
        }
        if (!sitemapSubmitted) gaps.push("No sitemap submitted to Search Console.");

        return ok({
          siteUrl: resolved,
          gscVerified,
          ga4,
          sitemapSubmitted,
          setupModeEnabled: setupEnabled(),
          gaps,
          note: gaps.length === 0 ? "Looks fully configured." : `${gaps.length} thing(s) to set up.`,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // Provisioning tools only register in setup mode (GSC_ENABLE_SETUP).
  if (!setupEnabled()) return;
  const gaFail = (e: unknown) => fail(new Error(gaErrorMessage(e)));

  server.registerTool(
    "list_ga_accounts",
    {
      title: "List Google Analytics accounts",
      description: "List the GA4 accounts you can create properties under (needed before create_ga4_property).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await listGaAccounts());
      } catch (e) {
        return gaFail(e);
      }
    }
  );

  server.registerTool(
    "create_ga4_property",
    {
      title: "Create a GA4 property + web data stream",
      description:
        "Create a new Google Analytics 4 property and a web data stream, returning the measurement ID (G-XXXX) " +
        "and a ready-to-install gtag snippet. Confirm with the user first (this creates a real GA property).",
      inputSchema: {
        accountId: z.string().describe("GA account ID to create under (from list_ga_accounts)."),
        displayName: z.string().describe("Property name, e.g. the site/brand name."),
        siteUrl: siteUrlOptional,
        timeZone: z.string().optional().describe("IANA time zone, e.g. 'Asia/Kolkata'. Default Etc/UTC."),
      },
    },
    async ({ accountId, displayName, siteUrl, timeZone }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok(await createGa4Property(accountId, displayName, siteToHttps(resolved), timeZone));
      } catch (e) {
        return gaFail(e);
      }
    }
  );

  server.registerTool(
    "get_verification_token",
    {
      title: "Get a site-verification token",
      description:
        "Get the verification token to prove ownership of a site. For domain properties this is a DNS TXT record " +
        "(the user must add it); for URL-prefix it's a meta tag/file (can be added to the repo). Then call verify_site.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        method: z.string().optional().describe("Override the method (DNS_TXT, META, FILE). Defaults by property type."),
      },
    },
    async ({ siteUrl, method }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok(await getVerificationToken(resolved, method));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "verify_site",
    {
      title: "Verify site ownership",
      description: "Ask Google to verify ownership once the token (DNS record or meta tag) is in place.",
      inputSchema: {
        siteUrl: siteUrlOptional,
        method: z.string().optional().describe("Must match the method used for get_verification_token."),
      },
    },
    async ({ siteUrl, method }) => {
      try {
        const { siteUrl: resolved } = ctx.resolveSite(siteUrl);
        return ok(await verifySite(resolved, method));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "list_gtm_accounts",
    {
      title: "List Google Tag Manager accounts",
      description: "List GTM accounts you can create containers under.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await listGtmAccounts());
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "create_gtm_container",
    {
      title: "Create a GTM container",
      description:
        "Create a web Google Tag Manager container and return the GTM ID + install snippet. Confirm with the user " +
        "first. (Adding the GA4 tag inside the container + publishing is a follow-up.)",
      inputSchema: {
        accountId: z.string().describe("GTM account ID (from list_gtm_accounts)."),
        name: z.string().describe("Container name, e.g. the site domain."),
      },
    },
    async ({ accountId, name }) => {
      try {
        return ok(await createGtmContainer(accountId, name));
      } catch (e) {
        return fail(e);
      }
    }
  );
  void SITE_URL_DESC;
};
