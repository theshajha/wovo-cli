#!/usr/bin/env node
// Wovo MCP server — lets Claude Code (or any MCP client) deploy HTML to a Wovo
// library and list pages. Thin client over the Wovo HTTP API.
//
// Configure with env vars:
//   WOVO_URL        base URL of your Wovo deployment (default https://wovo.dev)
//   WOVO_TOKEN      deploy token
//   WOVO_WORKSPACE  default workspace
//
// Register with Claude Code:
//   claude mcp add wovo --env WOVO_TOKEN=… --env WOVO_WORKSPACE=… -- npx -y wovo-mcp

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const URL_BASE = (process.env.WOVO_URL || "https://wovo.dev").replace(/\/$/, "");
const TOKEN = process.env.WOVO_TOKEN || "";
const DEFAULT_WS = process.env.WOVO_WORKSPACE || "default";

const server = new McpServer({ name: "wovo", version: "0.1.0" });

server.tool(
  "wovo_deploy",
  "Deploy an HTML page to the Wovo library and get back a live, shareable URL. " +
    "Provide either inline `html` or a file `path`. Re-deploying the same slug snapshots a new version.",
  {
    html: z.string().optional().describe("Inline HTML content to deploy."),
    path: z.string().optional().describe("Path to an .html file to read and deploy."),
    title: z.string().optional().describe("Human title (else taken from <title>)."),
    space: z.string().optional().describe("Group/space to file the page under, e.g. 'reports'."),
    slug: z.string().optional().describe("Stable slug for the page (else derived from title)."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
    tool: z.string().optional().describe("Source-tool tag (default 'claude-code')."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    let html = args.html;
    if (!html && args.path) {
      try {
        html = await readFile(path.resolve(args.path), "utf8");
      } catch (e) {
        return errText(`Could not read file '${args.path}': ${e.message}`);
      }
    }
    if (!html) return errText("Provide either `html` or `path`.");

    const res = await fetch(`${URL_BASE}/api/deploy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        workspace: args.workspace || DEFAULT_WS,
        slug: args.slug,
        title: args.title,
        space: args.space,
        sourceTool: args.tool || "claude-code",
        html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    return {
      content: [
        {
          type: "text",
          text:
            `✓ Deployed "${data.slug}" (v${data.version}) to workspace "${data.workspace}".\n` +
            `Live URL: ${data.url}\nRaw HTML: ${data.rawUrl}\nLibrary: ${URL_BASE}/w/${data.workspace}`,
        },
      ],
    };
  }
);

server.tool(
  "wovo_list",
  "List the pages in a Wovo workspace library.",
  { workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE).") },
  async (args) => {
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/pages?workspace=${encodeURIComponent(ws)}`);
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return errText(data.error || `HTTP ${res.status}`);
    const lines = data.pages
      .map((p) => `• ${p.slug} (${p.space}, v${p.currentVersion}) — ${p.title}\n  ${URL_BASE}/p/${ws}/${p.slug}`)
      .join("\n");
    return {
      content: [{ type: "text", text: `${data.count} page(s) in "${ws}":\n${lines || "(empty)"}` }],
    };
  }
);

function errText(msg) {
  return { isError: true, content: [{ type: "text", text: `✗ ${msg}` }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
