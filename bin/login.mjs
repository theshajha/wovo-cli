// Browser sign-in for the Wovo CLI (loopback flow — like `gh auth login`).
// Opens wovo.dev/cli/connect in the browser; after the user approves, wovo.dev
// redirects to a one-shot localhost server here with the workspace deploy token
// + the state nonce we generated. The token is stored in ~/.wovo/config.json —
// the user never copies a secret.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const CRED_DIR = path.join(os.homedir(), ".wovo");
export const CRED_FILE = path.join(CRED_DIR, "config.json");

export async function readCreds() {
  try {
    return JSON.parse(await readFile(CRED_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function writeCreds(creds) {
  await mkdir(CRED_DIR, { recursive: true });
  await writeFile(CRED_FILE, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start \"\"" : "xdg-open";
  try {
    execSync(`${cmd} "${url}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const DONE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Wovo connected</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#f6f3ee;color:#1c1a17;font-family:ui-sans-serif,system-ui,sans-serif;text-align:center}h1{font-weight:600}p{color:#57514a}</style></head><body><div><div style="font-size:40px">≋ ✅</div><h1>Wovo is connected</h1><p>You can close this tab and return to your terminal.</p></div></body></html>`;

/** Run the browser sign-in. Resolves to { token, url } and persists creds. */
export function login(cfg) {
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/") {
        res.writeHead(404);
        res.end();
        return;
      }
      const token = u.searchParams.get("token");
      const gotState = u.searchParams.get("state");
      if (!token || gotState !== state) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end("<h1>Invalid sign-in response.</h1><p>Run <code>npx @gowovo/wovo setup</code> again.</p>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(DONE_PAGE);
      clearTimeout(timer);
      server.close();
      writeCreds({ url: cfg.url, token })
        .then(() => resolve({ token, url: cfg.url }))
        .catch(reject);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Sign-in timed out. Run the command again."));
    }, 120000);

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = `${cfg.url}/cli/connect?port=${port}&state=${state}`;
      console.log("Opening your browser to connect Wovo…");
      const opened = !process.env.WOVO_NO_BROWSER && openBrowser(url);
      if (!opened) console.log("  Open this URL to continue:\n  " + url + "\n");
      else console.log("  (waiting for you to approve — if nothing opened, visit:\n  " + url + " )\n");
    });
  });
}
