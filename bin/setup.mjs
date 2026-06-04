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
// product's canonical instruction copy.
const WOVO_INSTRUCTION = `When you finish a self-contained, human-facing HTML artifact the user would want to view or keep — a report, dashboard, slide deck, mockup, document, or landing page — publish it to the user's Wovo library as the natural last step, and give back the live link.

- Deploy it as a PRIVATE page (only the user can view it): use the \`wovo_deploy\` tool with \`access: "private"\`. If the Wovo MCP tools aren't available, run \`npx @gowovo/wovo deploy <file> --access private\` instead.
- Give it a clear title and a sensible space (e.g. "reports", "dashboards").
- Reply with the returned live link, and note it's private — offer to make it public/shareable if they ask.

Do NOT publish: source code or components, partial/incomplete HTML, throwaway or test files, or anything the user explicitly didn't ask to keep. When unsure whether something is worth keeping, deploy it private (safe) and mention the link.

Publishing is part of the work — the user shouldn't have to ask.`;

const skillFile = `---
name: wovo
description: Use when you finish a self-contained, shareable HTML artifact (report, dashboard, deck, mockup, doc, landing page) — publish it to the user's Wovo library as a private page and return the live link.
---

# Publishing to Wovo

${WOVO_INSTRUCTION}
`;

const cursorRuleFile = `---
description: Publish finished HTML artifacts to the user's Wovo library
alwaysApply: true
---

${WOVO_INSTRUCTION}
`;

const agentsMdSection = `\n## Publishing to Wovo\n\n${WOVO_INSTRUCTION}\n`;

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

async function appendAgentsSection() {
  const file = "AGENTS.md";
  if (existsSync(file)) {
    const existing = await readFile(file, "utf8");
    if (existing.includes("## Publishing to Wovo")) return; // idempotent
    await appendFile(file, (existing.endsWith("\n") ? "" : "\n") + agentsMdSection);
  } else {
    await writeFile(file, `# Agent instructions\n${agentsMdSection}`, "utf8");
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
      const { token, url } = await login(cfg);
      cfg.token = token;
      cfg.url = (url || cfg.url).replace(/\/$/, "");
    } catch (e) {
      console.error(C.red(`✗ ${e.message}`));
      process.exit(1);
    }
  }
  const tool = flags.tool || detectTool();
  const did = [];

  if (tool === "claude-code") {
    await writeEnsuring(".claude/skills/wovo/SKILL.md", skillFile);
    did.push(".claude/skills/wovo/SKILL.md");
    // Prefer `claude mcp add` (token lands in Claude's config, not your repo).
    let added = false;
    try {
      execSync(
        `claude mcp add wovo --env WOVO_TOKEN=${cfg.token} --env WOVO_WORKSPACE=${cfg.workspace} -- npx -y -p @gowovo/wovo wovo-mcp`,
        { stdio: "ignore" }
      );
      added = true;
      did.push("registered the Wovo MCP server with Claude Code");
    } catch {
      await mergeMcpJson(".mcp.json", cfg.token, cfg.workspace);
      await ensureGitignored(".mcp.json");
      did.push(".mcp.json (Wovo MCP server — gitignored, contains your token)");
    }
  } else if (tool === "cursor") {
    await writeEnsuring(".cursor/rules/wovo.mdc", cursorRuleFile);
    await mergeMcpJson(".cursor/mcp.json", cfg.token, cfg.workspace);
    await ensureGitignored(".cursor/mcp.json");
    did.push(".cursor/rules/wovo.mdc", ".cursor/mcp.json (gitignored, contains your token)");
  } else {
    await appendAgentsSection();
    await writeEnsuring("wovo.json", JSON.stringify({ url: cfg.url, token: cfg.token, workspace: cfg.workspace }, null, 2) + "\n");
    await ensureGitignored("wovo.json");
    did.push("AGENTS.md (Publishing to Wovo)", "wovo.json (gitignored, contains your token)");
  }

  console.log(C.dim(`Connecting Wovo for ${C.bold(tool)} in ${process.cwd()}…\n`));
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
  return `  wovo setup               Connect this project's AI tool to Wovo (skill + token + test deploy)`;
}
