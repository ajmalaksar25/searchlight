// Copies API keys from .env (your editable source, gitignored) into
// bundled-keys.json (gitignored, shipped in the npm tarball) so the server can
// read them with zero runtime env setup. Run after editing .env:
//
//   npm run keys:sync
//
// Values are never printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (!fs.existsSync(envPath)) {
  console.error(".env not found — nothing to sync.");
  process.exit(0);
}

const env = fs.readFileSync(envPath, "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^\\s*" + k + "\\s*=\\s*(.*?)\\s*$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const pagespeedApiKey = get("PSI_API_KEY") || get("SEARCHLIGHT_PAGESPEED_API_KEY") || get("GSC_PAGESPEED_API_KEY");
const cruxApiKey = get("CRUX_API_KEY") || pagespeedApiKey;

if (!pagespeedApiKey) {
  console.error("No PSI_API_KEY (or GSC_PAGESPEED_API_KEY) found in .env.");
  process.exit(1);
}

fs.writeFileSync(
  path.join(root, "bundled-keys.json"),
  JSON.stringify({ pagespeedApiKey, cruxApiKey }, null, 2) + "\n"
);
console.log(
  "Wrote bundled-keys.json — pagespeed:",
  Boolean(pagespeedApiKey),
  "crux:",
  Boolean(cruxApiKey),
  "(values not printed)"
);
