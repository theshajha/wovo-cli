// `wovo setup` — connect the current project's AI tool to Wovo in one step.
// Writes a tool-native durable instruction (so the agent auto-publishes finished
// HTML to your library), wires the deploy token, and does a private test deploy.
// Pure deterministic file work — no giant prompt for an agent to interpret.

import { writeFile, mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { login } from "./login.mjs";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;173m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

// The durable behavior the agent follows from now on. Kept in sync with the
// product's canonical instruction copy. Three publish behaviors:
//   auto   — publish finished HTML privately without being asked (default)
//   ask    — offer first, publish on a yes
//   manual — only when the user explicitly asks
const PUBLISH_LINE = {
  auto: `publish it to the user's Wovo library as the natural last step, and give back the live link. Publishing is part of the work — the user shouldn't have to ask.`,
  ask: `offer to publish it to the user's Wovo library ("Want me to publish this so you have a live link?") and publish when they say yes.`,
  manual: `the user's Wovo library is where it can live — but only publish when the user explicitly asks you to (e.g. "publish this", "deploy to Wovo").`,
};

function wovoInstruction(behavior) {
  const line = PUBLISH_LINE[behavior] || PUBLISH_LINE.auto;
  return `When you finish a self-contained, human-facing HTML artifact the user would want to view or keep — a report, dashboard, slide deck, mockup, document, or landing page — ${line}

- Deploy it as a PRIVATE page (only the user can view it): use the \`wovo_deploy\` tool with \`access: "private"\`. If the Wovo MCP tools aren't available, run \`npx @gowovo/wovo deploy <file> --access private\` instead.
- Give it a clear title and a sensible space (e.g. "reports", "dashboards").
- Reply with the returned live link, and note it's private — offer to make it public/shareable if they ask.

Do NOT publish: source code or components, partial/incomplete HTML, throwaway or test files, or anything the user explicitly didn't ask to keep.`;
}

const SKILL_DESCRIPTION = {
  auto: "Use when you finish a self-contained, shareable HTML artifact (report, dashboard, deck, mockup, doc, landing page) — publish it to the user's Wovo library as a private page and return the live link.",
  ask: "Use when you finish a self-contained, shareable HTML artifact (report, dashboard, deck, mockup, doc, landing page) — offer to publish it to the user's Wovo library, and do so when they accept.",
  manual: "Use when the user asks to publish, deploy, or share an HTML artifact — send it to their Wovo library as a private page and return the live link.",
};

function skillFile(behavior) {
  return `---
name: wovo
description: ${SKILL_DESCRIPTION[behavior] || SKILL_DESCRIPTION.auto}
---

# Publishing to Wovo

${wovoInstruction(behavior)}
`;
}

function cursorRuleFile(behavior) {
  return `---
description: Publish finished HTML artifacts to the user's Wovo library
alwaysApply: true
---

${wovoInstruction(behavior)}
`;
}

function agentsMdSection(behavior) {
  return `\n## Publishing to Wovo\n\n${wovoInstruction(behavior)}\n`;
}

const WELCOME_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wovo is connected</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#f6f3ee;color:#1c1a17;font-family:ui-sans-serif,system-ui,sans-serif}.c{text-align:center}.m{font-size:40px}h1{font-weight:600;letter-spacing:-.02em}p{color:#57514a}</style></head><body><div class="c"><div class="m">≋ ✅</div><h1>Wovo is connected</h1><p>Your agent will publish what it builds here — automatically.</p></div></body></html>`;

function mcpServerEntry(token, ws) {
  return {
    command: "npx",
    args: ["-y", "-p", "@gowovo/wovo", "wovo-mcp"],
    env: { WOVO_TOKEN: token, WOVO_WORKSPACE: ws },
  };
}

function detectTool() {
  if (existsSync(".claude") || existsSync(path.join(process.env.HOME || "", ".claude.json"))) return "claude-code";
  if (existsSync(".cursor")) return "cursor";
  return "other";
}

async function writeEnsuring(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

async function mergeMcpJson(file, token, ws) {
  let json = {};
  if (existsSync(file)) {
    try {
      json = JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* start fresh on malformed config */
    }
  }
  json.mcpServers = { ...(json.mcpServers || {}), wovo: mcpServerEntry(token, ws) };
  await writeEnsuring(file, JSON.stringify(json, null, 2) + "\n");
}

async function ensureGitignored(...entries) {
  const gi = ".gitignore";
  let current = "";
  if (existsSync(gi)) current = await readFile(gi, "utf8");
  const missing = entries.filter((e) => !current.split(/\r?\n/).includes(e));
  if (missing.length) await appendFile(gi, (current && !current.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n");
}

async function appendAgentsSection(behavior) {
  const file = "AGENTS.md";
  if (existsSync(file)) {
    const existing = await readFile(file, "utf8");
    if (existing.includes("## Publishing to Wovo")) return; // idempotent
    await appendFile(file, (existing.endsWith("\n") ? "" : "\n") + agentsMdSection(behavior));
  } else {
    await writeFile(file, `# Agent instructions\n${agentsMdSection(behavior)}`, "utf8");
  }
}

async function testDeploy(cfg) {
  const res = await fetch(`${cfg.url}/api/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({
      workspace: cfg.workspace,
      slug: "welcome",
      title: "Wovo is connected",
      space: "general",
      sourceTool: "setup",
      access: { level: "private" },
      html: WELCOME_HTML,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.url;
}

export async function cmdSetup(cfg, flags) {
  // No token? Sign in via the browser (no secret to copy). --token stays the
  // CI/headless escape hatch.
  if (!cfg.token) {
    try {
      const { token, url, workspace } = await login(cfg);
      cfg.token = token;
      cfg.url = (url || cfg.url).replace(/\/$/, "");
      if (workspace) cfg.workspace = workspace;
    } catch (e) {
      console.error(C.red(`✗ ${e.message}`));
      process.exit(1);
    }
  }
  const tool = flags.tool || detectTool();
  // --scope project (default) writes into the current repo; --scope user writes
  // to the home directory so every project on this machine inherits the setup.
  const scope = flags.scope === "user" ? "user" : "project";
  const behavior = ["auto", "ask", "manual"].includes(flags.behavior) ? flags.behavior : "auto";
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const did = [];

  if (tool === "claude-code") {
    const skillPath =
      scope === "user" ? path.join(home, ".claude", "skills", "wovo", "SKILL.md") : ".claude/skills/wovo/SKILL.md";
    await writeEnsuring(skillPath, skillFile(behavior));
    did.push(skillPath);
    // Prefer `claude mcp add` (token lands in Claude's config, not your repo).
    try {
      const scopeFlag = scope === "user" ? " -s user" : "";
      execSync(
        `claude mcp add wovo${scopeFlag} --env WOVO_TOKEN=${cfg.token} --env WOVO_WORKSPACE=${cfg.workspace} -- npx -y -p @gowovo/wovo wovo-mcp`,
        { stdio: "ignore" }
      );
      did.push(`registered the Wovo MCP server with Claude Code${scope === "user" ? " (all projects)" : ""}`);
    } catch {
      await mergeMcpJson(".mcp.json", cfg.token, cfg.workspace);
      await ensureGitignored(".mcp.json");
      did.push(".mcp.json (Wovo MCP server — gitignored, contains your token)");
    }
  } else if (tool === "cursor") {
    if (scope === "user") {
      // Cursor's MCP config is global at ~/.cursor/mcp.json; rules stay
      // per-project, so drop the rule here too when we're inside a project.
      await mergeMcpJson(path.join(home, ".cursor", "mcp.json"), cfg.token, cfg.workspace);
      did.push("~/.cursor/mcp.json (Wovo MCP server — all projects)");
      await writeEnsuring(".cursor/rules/wovo.mdc", cursorRuleFile(behavior));
      did.push(".cursor/rules/wovo.mdc (Cursor rules are per-project — re-run in other projects)");
    } else {
      await writeEnsuring(".cursor/rules/wovo.mdc", cursorRuleFile(behavior));
      await mergeMcpJson(".cursor/mcp.json", cfg.token, cfg.workspace);
      await ensureGitignored(".cursor/mcp.json");
      did.push(".cursor/rules/wovo.mdc", ".cursor/mcp.json (gitignored, contains your token)");
    }
  } else {
    await appendAgentsSection(behavior);
    await writeEnsuring("wovo.json", JSON.stringify({ url: cfg.url, token: cfg.token, workspace: cfg.workspace }, null, 2) + "\n");
    await ensureGitignored("wovo.json");
    did.push("AGENTS.md (Publishing to Wovo)", "wovo.json (gitignored, contains your token)");
  }

  console.log(C.dim(`Connecting Wovo for ${C.bold(tool)} (${scope} scope, ${behavior} publishing) in ${process.cwd()}…\n`));
  for (const d of did) console.log(`  ${C.green("✓")} ${d}`);

  let url = "";
  try {
    url = await testDeploy(cfg);
    console.log(`  ${C.green("✓")} published a private test page`);
  } catch (e) {
    console.log(`  ${C.red("✗")} test deploy failed: ${e.message}`);
  }

  console.log(
    "\n" +
      C.bold("Wovo is connected.") +
      " From now on your agent publishes what it builds — privately — to your library." +
      (url ? "\n  " + C.accent(url) : "")
  );
}

export function setupHelp() {
  return `  wovo setup               Connect your AI tool to Wovo (skill + token + test deploy)
    --scope project|user        this project only, or every project on this machine
    --behavior auto|ask|manual  publish automatically (default), offer first, or only on request`;
}
