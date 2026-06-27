import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Spawn the server, run an MCP initialize + tools/list handshake, return data. */
function handshake() {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-test-"));
    const child = spawn(process.execPath, ["dist/index.js", "serve"], {
      cwd: root,
      env: { ...process.env, GSC_MCP_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", reject);

    let buf = "";
    let nonJson = false;
    let staged = false;
    const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          nonJson = true;
          continue;
        }
        // Only request tools after the initialize response has come back.
        if (m.id === 1 && !staged) {
          staged = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        }
        if (m.id === 2) {
          child.kill();
          resolve({ tools: (m.result?.tools ?? []).map((t) => t.name), nonJson });
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });

    setTimeout(() => {
      child.kill();
      reject(new Error("handshake timeout"));
    }, 25000);
  });
}

test("server registers the Phase-1 tool surface and keeps stdout clean", async () => {
  const { tools, nonJson } = await handshake();
  assert.equal(nonJson, false, "stdout must be pure JSON-RPC");
  for (const name of [
    "auth_status",
    "auth_login",
    "list_sites",
    "use_site",
    "account_overview",
    "query_search_analytics",
    "find_opportunities",
    "inspect_url",
    "list_sitemaps",
  ]) {
    assert.ok(tools.includes(name), `missing tool: ${name}`);
  }
  // Read-only mode must not expose write tools.
  assert.ok(!tools.includes("submit_sitemap"), "write tool leaked in read-only mode");
});
