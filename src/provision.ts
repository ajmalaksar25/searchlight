import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { gaAdmin } from "./ga.js";

/**
 * Setup-mode provisioning (Tier 2, behind GSC_ENABLE_SETUP). Creates GA4
 * properties + data streams, verifies site ownership, and creates GTM
 * containers — the programmatic half of /seo-setup. All write/edit scopes;
 * everything is confirmed by the skill before it runs. See SPEC §23.
 */
async function siteVer() {
  const auth = await getAuthClient();
  return google.siteVerification({ version: "v1", auth });
}

async function gtm() {
  const auth = await getAuthClient();
  return google.tagmanager({ version: "v2", auth });
}

export function gtagSnippet(measurementId: string): string {
  return (
    `<!-- Google tag (gtag.js) -->\n` +
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>\n` +
    `<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n` +
    `  gtag('js', new Date());\n  gtag('config', '${measurementId}');\n</script>`
  );
}

function gtmHeadSnippet(containerId: string): string {
  return (
    `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push(` +
    `{'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],` +
    `j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=` +
    `'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);` +
    `})(window,document,'script','dataLayer','${containerId}');</script>\n<!-- End Google Tag Manager -->`
  );
}

// ---------- Google Analytics 4 ----------

export interface GaAccount {
  accountId: string;
  name: string;
}

export async function listGaAccounts(): Promise<GaAccount[]> {
  const admin = await gaAdmin();
  const res = await admin.accountSummaries.list({ pageSize: 200 });
  return (res.data.accountSummaries ?? []).map((a) => ({
    accountId: (a.account ?? "").replace("accounts/", ""),
    name: a.displayName ?? "",
  }));
}

export interface CreatedProperty {
  propertyId: string;
  displayName: string;
  measurementId: string | null;
  gtagSnippet: string | null;
}

export async function createGa4Property(
  accountId: string,
  displayName: string,
  websiteUrl: string,
  timeZone = "Etc/UTC"
): Promise<CreatedProperty> {
  const admin = await gaAdmin();
  const prop = await admin.properties.create({
    requestBody: {
      parent: `accounts/${accountId}`,
      displayName,
      timeZone,
      currencyCode: "USD",
    },
  });
  const propertyName = prop.data.name ?? "";
  const stream = await admin.properties.dataStreams.create({
    parent: propertyName,
    requestBody: {
      type: "WEB_DATA_STREAM",
      displayName: `${displayName} Web`,
      webStreamData: { defaultUri: websiteUrl },
    },
  });
  const measurementId = stream.data.webStreamData?.measurementId ?? null;
  return {
    propertyId: propertyName.replace("properties/", ""),
    displayName,
    measurementId,
    gtagSnippet: measurementId ? gtagSnippet(measurementId) : null,
  };
}

// ---------- Site verification ----------

interface SiteIdentity {
  type: string;
  identifier: string;
  isDomain: boolean;
}

function siteIdentity(siteUrl: string): SiteIdentity {
  if (siteUrl.startsWith("sc-domain:")) {
    return { type: "INET_DOMAIN", identifier: siteUrl.slice("sc-domain:".length), isDomain: true };
  }
  return { type: "SITE", identifier: siteUrl, isDomain: false };
}

function verificationInstructions(id: SiteIdentity, method: string, token: string | null | undefined): string {
  if (id.isDomain || method.startsWith("DNS")) {
    return (
      `This is a domain property — it can only be verified via DNS. Add this TXT record at your DNS host ` +
      `(e.g. Cloudflare → DNS → Add record): Type=TXT, Name=@, Content="${token}", Proxy=DNS only. ` +
      `Wait a few minutes for propagation, then call verify_site again.`
    );
  }
  if (method === "META") {
    return `Add this tag to your homepage <head>, deploy, then call verify_site: ${token}`;
  }
  return `Place the verification token using the ${method} method, then call verify_site. Token: ${token}`;
}

export interface VerificationToken {
  method: string;
  token: string | null | undefined;
  identifier: string;
  isDomain: boolean;
  instructions: string;
}

export async function getVerificationToken(siteUrl: string, method?: string): Promise<VerificationToken> {
  const id = siteIdentity(siteUrl);
  const verificationMethod = method ?? (id.isDomain ? "DNS_TXT" : "META");
  const sv = await siteVer();
  const res = await sv.webResource.getToken({
    requestBody: { site: { type: id.type, identifier: id.identifier }, verificationMethod },
  });
  return {
    method: verificationMethod,
    token: res.data.token,
    identifier: id.identifier,
    isDomain: id.isDomain,
    instructions: verificationInstructions(id, verificationMethod, res.data.token),
  };
}

export async function verifySite(siteUrl: string, method?: string): Promise<{ verified: boolean; identifier: string; owners?: string[] }> {
  const id = siteIdentity(siteUrl);
  const verificationMethod = method ?? (id.isDomain ? "DNS_TXT" : "META");
  const sv = await siteVer();
  const res = await sv.webResource.insert({
    verificationMethod,
    requestBody: { site: { type: id.type, identifier: id.identifier } },
  });
  return { verified: true, identifier: id.identifier, owners: res.data.owners ?? undefined };
}

// ---------- Google Tag Manager ----------

export interface GtmAccount {
  accountId: string;
  name: string;
}

export async function listGtmAccounts(): Promise<GtmAccount[]> {
  const t = await gtm();
  const res = await t.accounts.list();
  return (res.data.account ?? []).map((a) => ({ accountId: a.accountId ?? "", name: a.name ?? "" }));
}

export interface CreatedContainer {
  containerId: string | null | undefined;
  path: string | null | undefined;
  headSnippet: string;
  note: string;
}

export async function createGtmContainer(accountId: string, name: string): Promise<CreatedContainer> {
  const t = await gtm();
  const res = await t.accounts.containers.create({
    parent: `accounts/${accountId}`,
    requestBody: { name, usageContext: ["web"] },
  });
  const containerId = res.data.publicId;
  return {
    containerId,
    path: res.data.path,
    headSnippet: containerId ? gtmHeadSnippet(containerId) : "",
    note:
      "Container created. Install the snippet, then add a GA4 configuration tag inside this container " +
      "(adding/publishing the GA4 tag programmatically is a follow-up; for now use the gtag snippet for " +
      "immediate measurement, or add the tag in the GTM UI).",
  };
}
