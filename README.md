# wovo

Deploy any HTML — from any AI tool or your terminal — to a **versioned, shareable library**. `wovo` is the CLI and MCP server for [wovo.dev](https://wovo.dev).

Every deploy snapshots a new version, returns a live URL, and files the page in your workspace library. Re-deploying the same slug never overwrites — it appends a version you can roll back to.

## Install

Install globally, then use the `wovo` command:

```bash
npm i -g @wovo/cli
wovo deploy ./report.html
```

Or run it one-off with `npx`:

```bash
npx -p @wovo/cli wovo deploy ./report.html
```

## Authenticate

Grab a **deploy token** from your workspace settings on [wovo.dev](https://wovo.dev), then provide it via env, a config file, or a flag:

```bash
export WOVO_TOKEN="wv_…"
export WOVO_WORKSPACE="my-workspace"
```

## CLI

```bash
wovo deploy <file|dir>   # deploy one .html, or every .html under a folder
wovo list                # list pages in the workspace
```

| Flag | Default | What it does |
|------|---------|--------------|
| `--workspace W` | env `WOVO_WORKSPACE` or `default` | Target workspace |
| `--space S` | top folder name | Group pages under a space |
| `--tool T` | `cli` | Source-tool tag |
| `--slug S` | derived from path | Explicit slug (single-file deploys) |
| `--url U` | env `WOVO_URL` or `https://wovo.dev` | Wovo base URL |
| `--token T` | env `WOVO_TOKEN` | Deploy token |

**Config resolution:** CLI flags → `./wovo.json` → env (`WOVO_URL`, `WOVO_TOKEN`, `WOVO_WORKSPACE`).

```jsonc
// wovo.json
{ "workspace": "my-workspace", "token": "wv_…", "space": "reports" }
```

### Examples

```bash
WOVO_TOKEN=… wovo deploy ./report.html --workspace acme
wovo deploy ./site --workspace acme --tool claude-code
wovo list --workspace acme
```

## MCP server

`wovo` also ships an [MCP](https://modelcontextprotocol.io) server (`wovo-mcp`) so AI agents can deploy and list pages as tools. Register it with Claude Code:

```bash
claude mcp add wovo \
  --env WOVO_TOKEN=wv_… \
  --env WOVO_WORKSPACE=my-workspace \
  -- npx -y -p @wovo/cli wovo-mcp
```

Tools: `wovo_deploy` (inline `html` or a file `path`) and `wovo_list`.

## Requirements

Node.js **>= 18** (uses the global `fetch`). Zero dependencies for the CLI; the MCP server uses `@modelcontextprotocol/sdk` and `zod`.

## License

MIT © Shashank Jha
