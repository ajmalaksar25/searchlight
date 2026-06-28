import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Install the bundled `searchlight` skill into a Claude skills directory so the
 * agent can run `/searchlight` (and `/searchlight audit`). The skill ships in the
 * npm tarball at the package root (one level above dist/); this copies it into
 * either the user-global skills dir (default) or the current project's.
 */
export function installSkill(opts: { here?: boolean } = {}): { target: string; files: string[] } {
  const src = fileURLToPath(new URL("../skill", import.meta.url));
  if (!fs.existsSync(src)) {
    throw new Error(
      `Bundled skill not found at ${src}. Reinstall @ajmalaksar/searchlight, or run from the package root.`
    );
  }
  const base = opts.here
    ? path.join(process.cwd(), ".claude", "skills")
    : path.join(os.homedir(), ".claude", "skills");
  const target = path.join(base, "searchlight");
  fs.mkdirSync(target, { recursive: true });

  const files: string[] = [];
  const copyDir = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(b, { recursive: true });
        copyDir(a, b);
      } else if (entry.isFile()) {
        fs.copyFileSync(a, b);
        files.push(path.relative(target, b));
      }
    }
  };
  copyDir(src, target);
  return { target, files };
}
