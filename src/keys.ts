import fs from "node:fs";

/**
 * PageSpeed Insights / CrUX API keys. Unlike the GSC OAuth client these are
 * project-level API keys (not user consent), so they are resolved the same way
 * as the bundled OAuth client: an explicit env var wins, otherwise the bundled
 * file shipped with the package (gitignored in source). See SPEC §10.
 */
interface BundledKeys {
  pagespeedApiKey?: string;
  cruxApiKey?: string;
}

function readBundledKeys(): BundledKeys {
  try {
    return JSON.parse(fs.readFileSync(new URL("../bundled-keys.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}

/** PageSpeed Insights API key: env var wins, then the bundled file. */
export function pagespeedApiKey(): string | undefined {
  return process.env.GSC_PAGESPEED_API_KEY || readBundledKeys().pagespeedApiKey || undefined;
}

/** CrUX API key: env var, then the bundled file, then falls back to the PSI key. */
export function cruxApiKey(): string | undefined {
  return process.env.GSC_CRUX_API_KEY || readBundledKeys().cruxApiKey || pagespeedApiKey();
}
