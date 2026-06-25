#!/usr/bin/env node
// Wovo CLI — deploy HTML to your Wovo library from any terminal.
//
//   wovo deploy <file|dir> [--workspace W] [--space S] [--tool T] [--slug S]
//   wovo list [--workspace W]
//
// Config resolves: CLI flags > ./wovo.json > env (WOVO_URL, WOVO_TOKEN, WOVO_WORKSPACE).
// Zero runtime dependencies — Node 18+ (global fetch).

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync, watch as fsWatch } from "node:fs";
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
    // Empty = let wovo.dev resolve it from the deploy token (the token is
    // bound to one workspace anyway). Never guess a name.
    workspace: flags.workspace || process.env.WOVO_WORKSPACE || file.workspace || creds.workspace || "",
    space: flags.space || file.space || "",
    tool: flags.tool || file.tool || "cli",
  };
  cfg.url = cfg.url.replace(/\/$/, "");
  return cfg;
}

// One place for every network call: a hard timeout (so a dead connection never
// hangs the CLI forever) and one retry on a transient failure (network blip /
// 5xx / timeout). Deploy, list, domains, and pages all route through here.
async function apiFetch(url, init = {}, { timeoutMs = 30_000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      // Retry once on a 5xx (the server may just be cold); 4xx is the caller's
      // problem and surfaces immediately.
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      return res;
    } catch (e) {
      const transient = e.name === "AbortError" || e.code === "ECONNRESET" || e.code === "ENOTFOUND" || e.code === "ECONNREFUSED";
      if (transient && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      if (e.name === "AbortError") throw new Error(`Timed out after ${timeoutMs / 1000}s — check your connection and try again.`);
      throw new Error(`Network error (${e.code || e.message}) — check your connection and try again.`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// Turn an API failure into something the user can act on, not a bare status code.
function failureMessage(res, data) {
  const base = data.error || `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return `${base} — run \`wovo setup\` to reconnect.`;
  if (res.status === 429) return `${base} (you're deploying a lot — wait a moment, then retry).`;
  return base;
}

async function collectHtml(target) {
  const abs = path.resolve(process.cwd(), target);
  const s = await stat(abs);
  if (s.isFile()) {
    if (!/\.html?$/i.test(abs)) {
      throw new Error(`${path.basename(abs)} isn't an HTML file. Pass a .html/.htm file, or a folder to deploy every page inside it.`);
    }
    return [{ abs, base: path.dirname(abs) }];
  }
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

// The deploy token is bound to one workspace server-side — when no workspace is
// configured locally, omit it and let wovo.dev resolve it from the token.
function wsBody(cfg) {
  return cfg.workspace ? { workspace: cfg.workspace } : {};
}
function wsQuery(cfg) {
  return cfg.workspace ? `workspace=${encodeURIComponent(cfg.workspace)}` : "";
}

async function deployOne(cfg, file, flags) {
  const html = await readFile(file.abs, "utf8");
  const { slug, space } = deriveMeta(file.abs, file.base, cfg, flags);
  // Private by default — your library is private; sharing is a deliberate
  // `--access public`. Matches the MCP/agent default so both paths behave alike.
  const level = flags.access || "private";
  const body = { ...wsBody(cfg), slug, space, sourceTool: cfg.tool, html, access: { level } };
  const res = await apiFetch(`${cfg.url}/api/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(failureMessage(res, data));
  }
  return { ...data, access: level };
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

  // Single page (the common case, and what an agent deploys): a prominent
  // receipt with the live link alone on its own line, so it never gets lost.
  if (files.length === 1) {
    const r = await deployOne(cfg, files[0], flags);
    printReceipt(cfg, r);
    return;
  }

  console.log(C.dim(`Deploying ${files.length} pages to ${cfg.url}\n`));
  let ok = 0;
  let lastWs = "";
  for (const file of files) {
    try {
      const r = await deployOne(cfg, file, flags);
      lastWs = r.workspace;
      const url = `${cfg.url}/p/${r.workspace}/${r.slug}`;
      console.log(`  ${C.green("✓")} ${r.slug.padEnd(38)} ${C.accent(url)}${r.version > 1 ? C.dim(`  v${r.version}`) : ""}`);
      ok++;
    } catch (e) {
      console.log(`  ${C.red("✗")} ${path.basename(file.abs).padEnd(38)} ${C.red(e.message)}`);
    }
  }
  console.log(
    "\n" +
      C.bold(`${ok}/${files.length} deployed.`) +
      (lastWs ? "  Library: " + C.accent(`${cfg.url}/w/${lastWs}`) : "")
  );
}

// The deploy "receipt" — the live link on its own line, impossible to miss in a
// wall of agent output. Used for single-page deploys and every watch save.
function printReceipt(cfg, r, { prefix = "" } = {}) {
  const url = `${cfg.url}/p/${r.workspace}/${r.slug}`;
  const meta = [`v${r.version}`, r.access].filter(Boolean).join(" · ");
  console.log(`${prefix}  ${C.green("✓")} ${C.bold("Published")} ${r.slug} ${C.dim(`(${meta})`)}`);
  console.log(`${prefix}     ${C.accent(url)}`);
  console.log(`${prefix}     ${C.dim("Library:")} ${C.accent(`${cfg.url}/w/${r.workspace}`)}`);
}

// `wovo watch <file|dir>` — auto-publish on every save. The deterministic sync
// path: no agent has to remember to deploy, so an exported design lands the
// instant it's written. Saves are private unless `--access` says otherwise.
async function cmdWatch(target, cfg, flags) {
  if (!cfg.token) {
    console.error(C.red("✗ No deploy token. Run `wovo setup` first."));
    process.exit(1);
  }
  if (!target) {
    console.error(C.red("✗ Usage: wovo watch <file|dir>"));
    process.exit(1);
  }
  const absTarget = path.resolve(process.cwd(), target);
  if (!existsSync(absTarget)) {
    console.error(C.red(`✗ Not found: ${target}`));
    process.exit(1);
  }
  const isDir = (await stat(absTarget)).isDirectory();
  if (!isDir && !/\.html?$/i.test(absTarget)) {
    console.error(C.red(`✗ ${path.basename(absTarget)} isn't an HTML file.`));
    process.exit(1);
  }
  // Watch the parent dir even for a single file: editors and export tools save
  // atomically (write a temp file, then rename), which breaks a watch bound to
  // the file's own inode. We filter events down to the file we care about.
  const watchDir = isDir ? absTarget : path.dirname(absTarget);
  const onlyFile = isDir ? null : path.basename(absTarget);
  const watchFlags = { ...flags, access: flags.access || "private" };
  const ts = () => new Date().toTimeString().slice(0, 8);
  const pending = new Map();

  const deployChanged = async (abs) => {
    try {
      const r = await deployOne(cfg, { abs, base: watchDir }, watchFlags);
      console.log(C.dim(`  ${ts()} `) + `${C.green("✓")} ${r.slug} ${C.dim(`v${r.version}`)}  ${C.accent(`${cfg.url}/p/${r.workspace}/${r.slug}`)}`);
    } catch (e) {
      console.log(C.dim(`  ${ts()} `) + `${C.red("✗")} ${path.basename(abs)}  ${C.red(e.message)}`);
    }
  };

  const onChange = (_event, filename) => {
    if (!filename) return;
    const name = filename.toString();
    const bn = path.basename(name);
    if (onlyFile && bn !== onlyFile) return;
    if (bn.startsWith(".") || !/\.html?$/i.test(bn)) return; // skip temp/dotfiles
    const abs = path.isAbsolute(name) ? name : path.join(watchDir, name);
    if (!existsSync(abs)) return; // a delete/rename-away event — nothing to deploy
    clearTimeout(pending.get(abs)); // debounce a burst of writes into one deploy
    // ~1s window: coalesces an editor/export tool's multi-write save into one
    // deploy, and keeps frequent saves from burning the per-token deploy rate
    // limit (each deploy is a new version). A 429 still surfaces as an actionable
    // line and the watch keeps running.
    pending.set(abs, setTimeout(() => { pending.delete(abs); deployChanged(abs); }, 800));
  };

  let watcher;
  try {
    watcher = fsWatch(watchDir, { recursive: isDir }, onChange);
  } catch {
    // Recursive watch isn't supported on every OS/Node; fall back to a flat watch
    // (top-level saves still sync — note nested folders need Node 20+ on Linux).
    watcher = fsWatch(watchDir, onChange);
  }
  // A dead watcher must never fail silently — that looks identical to "nothing
  // changed". Surface the error and exit so the user knows to restart it.
  watcher.on("error", (err) => {
    console.error(C.red(`\n✗ Watch stopped: ${err.message}. Re-run \`wovo watch ${target}\`.`));
    process.exit(1);
  });

  console.log(`${C.bold("Watching")} ${C.accent(target)} ${C.dim("— saves auto-publish (private). Ctrl+C to stop.")}`);
  process.on("SIGINT", () => {
    watcher.close();
    console.log(C.dim("\nStopped watching."));
    process.exit(0);
  });
  await new Promise(() => {}); // keep the process alive until interrupted
}

async function cmdList(cfg) {
  // Token-authenticated: the workspace's own token sees every page; without it
  // the API returns only the anonymous view (and 403s private workspaces).
  const res = await apiFetch(`${cfg.url}/api/pages?${wsQuery(cfg)}`, {
    headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    console.error(C.red(`✗ ${failureMessage(res, data)}`));
    process.exit(1);
  }
  console.log(C.bold(`${data.count} page(s) in ${data.workspace}\n`));
  for (const p of data.pages) {
    console.log(`  ${C.accent(p.slug.padEnd(40))} ${C.dim(p.space)}  v${p.currentVersion}  ${p.title}`);
  }
}

async function domainsFetch(cfg, path, init = {}) {
  if (!cfg.token) {
    console.error(C.red("✗ No deploy token. Set WOVO_TOKEN (env), wovo.json, or --token."));
    process.exit(1);
  }
  const res = await apiFetch(`${cfg.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(failureMessage(res, data));
  }
  return data;
}

function printDns(dns, verification) {
  if (dns?.length) {
    console.log(C.bold("\nDNS — add at your provider:"));
    for (const r of dns) {
      console.log(`  ${C.dim("Type")}  ${r.type}`);
      console.log(`  ${C.dim("Name")}  ${r.name}`);
      console.log(`  ${C.dim("Value")} ${r.value}\n`);
    }
  }
  if (verification?.length) {
    console.log(C.bold("Ownership verification (if prompted):"));
    for (const v of verification) {
      console.log(`  ${v.type}  ${v.domain}`);
      console.log(`  ${v.value}\n`);
    }
  }
}

async function cmdDomainsList(cfg) {
  const data = await domainsFetch(cfg, `/api/domains?${wsQuery(cfg)}`);
  console.log(C.bold(`${data.count} domain(s) in ${data.workspace}\n`));
  for (const d of data.domains) {
    console.log(
      `  ${C.accent(d.domain.padEnd(36))} ${C.dim(d.status.padEnd(14))} → ${d.slug}`
    );
  }
}

async function cmdDomainsAdd(cfg, domain, flags) {
  const slug = flags.page;
  if (!domain || !slug) {
    console.error(C.red("✗ Usage: wovo domains add <domain> --page <slug>"));
    process.exit(1);
  }
  const data = await domainsFetch(cfg, "/api/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...wsBody(cfg), domain, slug }),
  });
  console.log(C.green(`✓ Linked ${data.link.domain} → ${data.link.slug} (${data.link.status})`));
  printDns(data.dns, data.verification);
}

async function cmdDomainsRemove(cfg, domain) {
  if (!domain) {
    console.error(C.red("✗ Usage: wovo domains remove <domain>"));
    process.exit(1);
  }
  await domainsFetch(
    cfg,
    `/api/domains?${wsQuery(cfg)}&domain=${encodeURIComponent(domain)}`,
    { method: "DELETE" }
  );
  console.log(C.green(`✓ Unlinked ${domain}`));
}

async function cmdDomainsStatus(cfg, domain) {
  if (!domain) {
    console.error(C.red("✗ Usage: wovo domains status <domain>"));
    process.exit(1);
  }
  const data = await domainsFetch(cfg, "/api/domains/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...wsBody(cfg), domain }),
  });
  console.log(`${C.bold(domain)}  ${C.dim(data.link.status)}  → ${data.link.slug}`);
  printDns(data.dns, data.verification);
}

async function pagesMutate(cfg, body) {
  if (!cfg.token) {
    console.error(C.red("✗ No deploy token. Set WOVO_TOKEN (env), wovo.json, or --token."));
    process.exit(1);
  }
  const res = await apiFetch(`${cfg.url}/api/pages`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ ...wsBody(cfg), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(failureMessage(res, data));
  }
  return data;
}

async function cmdPagesArchive(cfg, slug) {
  if (!slug) {
    console.error(C.red("✗ Usage: wovo pages archive <slug>"));
    process.exit(1);
  }
  const data = await pagesMutate(cfg, { slug, action: "archive" });
  console.log(C.green(`✓ Archived ${data.page.slug}`));
}

async function cmdPagesUnarchive(cfg, slug) {
  if (!slug) {
    console.error(C.red("✗ Usage: wovo pages unarchive <slug>"));
    process.exit(1);
  }
  const data = await pagesMutate(cfg, { slug, action: "unarchive" });
  console.log(C.green(`✓ Unarchived ${data.page.slug}`));
}

async function cmdPagesMove(cfg, slug, flags) {
  const space = flags.space;
  if (!slug || !space) {
    console.error(C.red("✗ Usage: wovo pages move <slug> --space <name>"));
    process.exit(1);
  }
  const data = await pagesMutate(cfg, { slug, action: "move", space });
  console.log(C.green(`✓ Moved ${data.page.slug} → space "${data.page.space}"`));
}

async function cmdPagesRename(cfg, slug, newSlug) {
  if (!slug || !newSlug) {
    console.error(C.red("✗ Usage: wovo pages rename <slug> <new-slug>"));
    process.exit(1);
  }
  const data = await pagesMutate(cfg, { slug, action: "rename", newSlug });
  const ws = data.workspace || cfg.workspace;
  console.log(C.green(`✓ Moved ${slug} → ${data.page.slug}`));
  console.log(C.dim(`  Old links redirect.${ws ? ` Live at ${cfg.url}/p/${ws}/${data.page.slug}` : ""}`));
}

async function cmdPages(sub, cfg, flags, rest) {
  if (!sub || sub === "help") {
    console.log(`${C.bold("wovo pages")}
  archive <slug>           Hide a page from the library (link still works)
  unarchive <slug>         Restore an archived page to the library
  move <slug> --space S    Change a page's space
  rename <slug> <new>      Change a page's path; old links redirect
`);
    return;
  }
  if (sub === "archive") return cmdPagesArchive(cfg, rest[0]);
  if (sub === "unarchive") return cmdPagesUnarchive(cfg, rest[0]);
  if (sub === "move") return cmdPagesMove(cfg, rest[0], flags);
  if (sub === "rename") return cmdPagesRename(cfg, rest[0], rest[1]);
  console.error(C.red(`Unknown pages command: ${sub}`));
  process.exit(1);
}

async function cmdDomains(sub, cfg, flags, rest) {
  if (!sub || sub === "help") {
    console.log(`${C.bold("wovo domains")}
  list                         List linked domains
  add <domain> --page <slug>   Link a domain to a public page
  remove <domain>              Unlink a domain
  status <domain>              Refresh and show DNS / verification status
`);
    return;
  }
  if (sub === "list") return cmdDomainsList(cfg);
  if (sub === "add") return cmdDomainsAdd(cfg, rest[0], flags);
  if (sub === "remove") return cmdDomainsRemove(cfg, rest[0]);
  if (sub === "status") return cmdDomainsStatus(cfg, rest[0]);
  console.error(C.red(`Unknown domains command: ${sub}`));
  process.exit(1);
}

function help() {
  console.log(`${C.accent("w.")} ${C.bold("wovo")} — the library for everything your agents build

${C.bold("Usage")}
  wovo setup               Connect your AI tool to Wovo (skill + token + test deploy)
                           --scope project|user   this project only, or every project (default: project)
                           --behavior auto|ask|manual   publish automatically, offer first, or only on request
  wovo deploy <file|dir>   Deploy one HTML file, or every .html under a folder
  wovo watch <file|dir>    Auto-publish on every save (great for design-export loops)
  wovo list                List pages in the workspace
  wovo pages               Archive, unarchive, or move pages
  wovo domains             Manage custom domains (list, add, remove, status)

${C.bold("Options")}
  --workspace W            Target workspace (default: resolved from your deploy token)
  --space S                Group pages under a space (default: top folder name)
  --tool T                 Source tool tag (default: "cli")
  --slug S                 Explicit slug (single-file deploys)
  --page S                 Target page slug (domains add)
  --access LEVEL           private | team | public | password (default: private)
  --url U                  Wovo base URL (default: env WOVO_URL or https://wovo.dev)
  --token T                Deploy token (default: env WOVO_TOKEN)

${C.bold("Examples")}
  wovo deploy ./report.html                 publish one page (private)
  wovo deploy ./report.html --access public  publish a shareable link
  wovo watch ./designs                       auto-publish exports as you save
`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];
  const cfg = loadConfig(flags);

  if (!cmd || cmd === "help" || flags.help) return help();
  if (cmd === "setup") return cmdSetup(cfg, flags);
  if (cmd === "deploy") return cmdDeploy(flags._[1], cfg, flags);
  if (cmd === "watch") return cmdWatch(flags._[1], cfg, flags);
  if (cmd === "list") return cmdList(cfg);
  if (cmd === "pages") return cmdPages(flags._[1], cfg, flags, flags._.slice(2));
  if (cmd === "domains") return cmdDomains(flags._[1], cfg, flags, flags._.slice(2));
  console.error(C.red(`Unknown command: ${cmd}`));
  help();
  process.exit(1);
}

main().catch((e) => {
  console.error(C.red(`✗ ${e.message}`));
  process.exit(1);
});
