# wovo

Deploy any HTML — from any AI tool or your terminal — to a **versioned, shareable library**. `wovo` is the CLI and MCP server for [wovo.dev](https://wovo.dev).

Every deploy snapshots a new version, returns a live URL, and files the page in your workspace library. Re-deploying the same slug never overwrites — it appends a version you can roll back to.

## Install

Run it one-off with `npx`:

```bash
npx @gowovo/wovo deploy ./report.html
```

Or install globally and use the `wovo` command:

```bash
npm i -g @gowovo/wovo
wovo deploy ./report.html
```

## Authenticate

Grab a **deploy token** from your workspace settings on [wovo.dev](https://wovo.dev), then provide it via env, a config file, or a flag:

```bash
export WOVO_TOKEN="wv_…"
export WOVO_WORKSPACE="my-workspace"
```

## CLI

```bash
wovo setup               # connect your AI tool: browser sign-in + skill + MCP + test deploy
                         #   --scope project|user        this project, or every project on this machine
                         #   --behavior auto|ask|manual  publish automatically, offer first, or only on request
wovo deploy <file|dir>   # deploy one .html, or every .html under a folder
wovo list                # list pages in the workspace
wovo pages archive <slug>          # hide a page from the library (link still works)
wovo pages unarchive <slug>        # restore an archived page
wovo pages move <slug> --space S   # change a page's space
wovo pages rename <slug> <new>     # change a page's path; old links redirect
wovo domains list                  # custom domains
wovo domains add <d> --page <slug> # link a domain (prints DNS records)
wovo domains status <d>            # re-check DNS / verification
wovo domains remove <d>            # unlink a domain
```

| Flag | Default | What it does |
|------|---------|--------------|
| `--workspace W` | env `WOVO_WORKSPACE`, else resolved from the token | Target workspace |
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
  -- npx -y -p @gowovo/wovo wovo-mcp
```

Tools: `wovo_deploy` (inline `html` or a file `path`), `wovo_list`, `wovo_pages_archive`,
`wovo_pages_unarchive`, `wovo_pages_move`, `wovo_pages_rename`, `wovo_domains_list`,
`wovo_domains_add`, `wovo_domains_remove`, `wovo_domains_status`.

## Requirements

Node.js **>= 18** (uses the global `fetch`). Zero dependencies for the CLI; the MCP server uses `@modelcontextprotocol/sdk` and `zod`.

## License

MIT © Shashank Jha
