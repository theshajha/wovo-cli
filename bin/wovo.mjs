#!/usr/bin/env node
// Wovo CLI — deploy HTML to your Wovo library from any terminal.
//
//   wovo deploy <file|dir> [--workspace W] [--space S] [--tool T] [--slug S]
//   wovo list [--workspace W]
//
// Config resolves: CLI flags > ./wovo.json > env (WOVO_URL, WOVO_TOKEN, WOVO_WORKSPACE).
// Zero runtime dependencies — Node 18+ (global fetch).

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { cmdSetup } from "./setup.mjs";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;173m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function loadConfig(flags) {
  let file = {};
  const cfgPath = path.resolve(process.cwd(), "wovo.json");
  if (existsSync(cfgPath)) {
    try {
      file = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {
      /* ignore malformed config */
    }
  }
  let creds = {};
  const credPath = path.join(os.homedir(), ".wovo", "config.json");
  if (existsSync(credPath)) {
    try {
      creds = JSON.parse(readFileSync(credPath, "utf8"));
    } catch {
      /* ignore malformed creds */
    }
  }
  const cfg = {
    url: flags.url || process.env.WOVO_URL || file.url || creds.url || "https://wovo.dev",
    token: flags.token || process.env.WOVO_TOKEN || file.token || creds.token || "",
    workspace: flags.workspace || process.env.WOVO_WORKSPACE || file.workspace || "default",
    space: flags.space || file.space || "",
    tool: flags.tool || file.tool || "cli",
  };
  cfg.url = cfg.url.replace(/\/$/, "");
  return cfg;
}

async function collectHtml(target) {
  const abs = path.resolve(process.cwd(), target);
  const s = await stat(abs);
  if (s.isFile()) return [{ abs, base: path.dirname(abs) }];
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (/\.html?$/i.test(entry.name)) files.push({ abs: p, base: abs });
    }
  }
  await walk(abs);
  return files;
}

function deriveMeta(absPath, baseDir, cfg, flags) {
  const rel = path.relative(baseDir, absPath).replace(/\\/g, "/");
  const noExt = rel.replace(/\.html?$/i, "");
  const segments = noExt.split("/");
  const slug = flags.slug || segments.join("-").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  const space = cfg.space || (segments.length > 1 ? segments[0] : "general");
  return { slug, space };
}

async function deployOne(cfg, file, flags) {
  const html = await readFile(file.abs, "utf8");
  const { slug, space } = deriveMeta(file.abs, file.base, cfg, flags);
  const body = { workspace: cfg.workspace, slug, space, sourceTool: cfg.tool, html };
  if (flags.access) body.access = { level: flags.access };
  const res = await fetch(`${cfg.url}/api/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function cmdDeploy(target, cfg, flags) {
  if (!cfg.token) {
    console.error(C.red("✗ No deploy token. Set WOVO_TOKEN (env), wovo.json, or --token."));
    process.exit(1);
  }
  if (!target) {
    console.error(C.red("✗ Usage: wovo deploy <file|dir>"));
    process.exit(1);
  }
  const files = await collectHtml(target);
  if (files.length === 0) {
    console.error(C.red(`✗ No .html files found at ${target}`));
    process.exit(1);
  }
  console.log(
    C.dim(`Deploying ${files.length} page${files.length === 1 ? "" : "s"} to `) +
      C.bold(cfg.workspace) +
      C.dim(` at ${cfg.url}\n`)
  );

  let ok = 0;
  let lastWs = "";
  for (const file of files) {
    try {
      const r = await deployOne(cfg, file, flags);
      lastWs = r.workspace;
      const url = `${cfg.url}/p/${r.workspace}/${r.slug}`;
      console.log(`  ${C.green("✓")} ${r.slug.padEnd(42)} ${C.accent(url)}${r.version > 1 ? C.dim(`  v${r.version}`) : ""}`);
      ok++;
    } catch (e) {
      console.log(`  ${C.red("✗")} ${path.basename(file.abs).padEnd(42)} ${C.red(e.message)}`);
    }
  }
  console.log(
    "\n" +
      C.bold(`${ok}/${files.length} deployed.`) +
      (lastWs ? "  Library: " + C.accent(`${cfg.url}/w/${lastWs}`) : "")
  );
}

async function cmdList(cfg) {
  // Token-authenticated: the workspace's own token sees every page; without it
  // the API returns only the anonymous view (and 403s private workspaces).
  const res = await fetch(`${cfg.url}/api/pages?workspace=${encodeURIComponent(cfg.workspace)}`, {
    headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error(C.red(`✗ ${data.error || "Failed to list pages."}`));
    process.exit(1);
  }
  console.log(C.bold(`${data.count} page(s) in ${data.workspace}\n`));
  for (const p of data.pages) {
    console.log(`  ${C.accent(p.slug.padEnd(40))} ${C.dim(p.space)}  v${p.currentVersion}  ${p.title}`);
  }
}

function help() {
  console.log(`${C.accent("≋ wovo")} — the library for everything your agents build

${C.bold("Usage")}
  wovo setup               Connect this project's AI tool to Wovo (skill + token + test)
  wovo deploy <file|dir>   Deploy one HTML file, or every .html under a folder
  wovo list                List pages in the workspace

${C.bold("Options")}
  --workspace W            Target workspace (default: env WOVO_WORKSPACE or "default")
  --space S                Group pages under a space (default: top folder name)
  --tool T                 Source tool tag (default: "cli")
  --slug S                 Explicit slug (single-file deploys)
  --access LEVEL           private | team | public | password (default: public-by-link)
  --url U                  Wovo base URL (default: env WOVO_URL or https://wovo.dev)
  --token T                Deploy token (default: env WOVO_TOKEN)

${C.bold("Examples")}
  WOVO_TOKEN=… wovo deploy ./report.html --workspace acme
  wovo deploy ./site --workspace acme --tool claude-code
`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];
  const cfg = loadConfig(flags);

  if (!cmd || cmd === "help" || flags.help) return help();
  if (cmd === "setup") return cmdSetup(cfg, flags);
  if (cmd === "deploy") return cmdDeploy(flags._[1], cfg, flags);
  if (cmd === "list") return cmdList(cfg);
  console.error(C.red(`Unknown command: ${cmd}`));
  help();
  process.exit(1);
}

main().catch((e) => {
  console.error(C.red(`✗ ${e.message}`));
  process.exit(1);
});
