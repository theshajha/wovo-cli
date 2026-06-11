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
    access: z
      .enum(["private", "team", "public", "password"])
      .optional()
      .describe("Page visibility. Defaults to 'private' for agent deploys — only the workspace owner can view it. Use 'public' only when the user explicitly wants a shareable link."),
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
        access: { level: args.access || "private" },
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
    // The token authenticates the listing: the workspace's own token sees every
    // page; without it the API returns only the anonymous view (and 403s
    // private workspaces).
    const res = await fetch(`${URL_BASE}/api/pages?workspace=${encodeURIComponent(ws)}`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    });
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

server.tool(
  "wovo_pages_archive",
  "Archive a page — hidden from the default library, but its /p link still works.",
  {
    slug: z.string().describe("Page slug to archive."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/pages`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ workspace: ws, slug: args.slug, action: "archive" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    return { content: [{ type: "text", text: `✓ Archived "${args.slug}" in "${ws}".` }] };
  }
);

server.tool(
  "wovo_pages_unarchive",
  "Restore an archived page to the active library.",
  {
    slug: z.string().describe("Page slug to unarchive."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/pages`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ workspace: ws, slug: args.slug, action: "unarchive" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    return { content: [{ type: "text", text: `✓ Unarchived "${args.slug}" in "${ws}".` }] };
  }
);

server.tool(
  "wovo_pages_move",
  "Change a page's space (group) in the library.",
  {
    slug: z.string().describe("Page slug to move."),
    space: z.string().describe("Target space name."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/pages`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ workspace: ws, slug: args.slug, action: "move", space: args.space }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    return {
      content: [{ type: "text", text: `✓ Moved "${args.slug}" to space "${data.page.space}" in "${ws}".` }],
    };
  }
);

server.tool(
  "wovo_domains_list",
  "List custom domains linked to the Wovo workspace.",
  { workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE).") },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/domains?workspace=${encodeURIComponent(ws)}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    const lines = data.domains
      .map((d) => `• ${d.domain} (${d.status}) → ${d.slug}`)
      .join("\n");
    return {
      content: [{ type: "text", text: `${data.count} domain(s) in "${ws}":\n${lines || "(none)"}` }],
    };
  }
);

server.tool(
  "wovo_domains_add",
  "Link a custom domain to a public page. Returns DNS setup instructions.",
  {
    domain: z.string().describe("Domain to link, e.g. report.acme.com"),
    page: z.string().describe("Slug of the public page to serve at the domain root."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/domains`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ workspace: ws, domain: args.domain, slug: args.page }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    const dns = (data.dns || [])
      .map((r) => `${r.type} ${r.name} → ${r.value}`)
      .join("\n");
    const txt = (data.verification || [])
      .map((v) => `${v.type} ${v.domain} → ${v.value}`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text:
            `✓ Linked ${data.link.domain} → ${data.link.slug} (${data.link.status})\n` +
            (dns ? `\nDNS:\n${dns}` : "") +
            (txt ? `\n\nVerification:\n${txt}` : ""),
        },
      ],
    };
  }
);

server.tool(
  "wovo_domains_remove",
  "Unlink a custom domain from the workspace.",
  {
    domain: z.string().describe("Domain to unlink."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(
      `${URL_BASE}/api/domains?workspace=${encodeURIComponent(ws)}&domain=${encodeURIComponent(args.domain)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    return { content: [{ type: "text", text: `✓ Unlinked ${args.domain}` }] };
  }
);

server.tool(
  "wovo_domains_status",
  "Refresh a domain's DNS/verification status and return setup instructions.",
  {
    domain: z.string().describe("Domain to check."),
    workspace: z.string().optional().describe("Workspace (defaults to WOVO_WORKSPACE)."),
  },
  async (args) => {
    if (!TOKEN) return errText("WOVO_TOKEN is not set on the MCP server environment.");
    const ws = args.workspace || DEFAULT_WS;
    const res = await fetch(`${URL_BASE}/api/domains/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ workspace: ws, domain: args.domain }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return errText(data.error || `HTTP ${res.status}`);
    const dns = (data.dns || [])
      .map((r) => `${r.type} ${r.name} → ${r.value}`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `${args.domain}: ${data.link.status} → ${data.link.slug}` + (dns ? `\n\nDNS:\n${dns}` : ""),
        },
      ],
    };
  }
);

function errText(msg) {
  return { isError: true, content: [{ type: "text", text: `✗ ${msg}` }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
