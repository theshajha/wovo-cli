# Changelog

All notable changes to the `wovo` package are documented here. This project
adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [Unreleased]

## [0.1.5]

### Added

- **`wovo domains`** — manage custom domains against wovo.dev's `/api/domains`:
  `list`, `add <domain> --page <slug>`, `remove <domain>`, `status <domain>`.
  `add` prints DNS instructions (A/CNAME + TXT verification when needed).
- MCP tools: `wovo_domains_list`, `wovo_domains_add`, `wovo_domains_remove`,
  `wovo_domains_status`.

## [0.1.4]

### Fixed

- **`list` sends the deploy token.** `wovo list` and the MCP `wovo_list` now
  authenticate with `Authorization: Bearer <token>`. wovo.dev's `/api/pages`
  is access-filtered: the workspace's own token sees every page, while
  unauthenticated callers get the anonymous view (private workspaces 403,
  owner-only/team pages hidden). Older versions can still list public
  workspaces but will see a 403 on private ones — upgrade.

## [0.1.3]

### Added

- **Browser sign-in.** `wovo setup` with no `--token` opens the browser to
  authorize (loopback flow); the deploy token is handed back via a one-shot
  `127.0.0.1` callback and stored in `~/.wovo` — nothing to copy. `--token` (and
  `WOVO_TOKEN`) remain for CI/headless. `deploy`/`list` reuse the stored session.

## [0.1.2]

### Added

- `wovo setup [--tool <claude-code|cursor|other>]` — one command that connects
  the current project's AI tool to Wovo: writes a tool-native durable instruction
  (Claude Code skill / Cursor rule / `AGENTS.md`) so the agent auto-publishes
  finished HTML to your library, wires the deploy token, and publishes a private
  test page. Secrets written to the project (`.mcp.json` / `.cursor/mcp.json` /
  `wovo.json`) are gitignored automatically.

## [0.1.1]

### Added

- `wovo_deploy` (MCP) `access` option — defaults to `private` for agent deploys
  (the ambient auto-save path is private unless asked otherwise).
- CLI `--access <private|team|public|password>` flag; the bare default is
  unchanged (a public, link-viewable page).

## [0.1.0] — unreleased

Initial public release of the `wovo` CLI + MCP server.

### Added

- `wovo deploy <file|dir>` — deploy one HTML file, or every `.html` under a
  folder, to a versioned Wovo library; prints the live URL per page.
- `wovo list` — list the pages in a workspace.
- Config resolution: CLI flags → `./wovo.json` → env
  (`WOVO_URL`, `WOVO_TOKEN`, `WOVO_WORKSPACE`). Defaults to `https://wovo.dev`.
- `wovo-mcp` — MCP server exposing `wovo_deploy` and `wovo_list` tools for AI
  agents (Claude Code and any MCP client).

[Unreleased]: https://github.com/theshajha/wovo-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/theshajha/wovo-cli/releases/tag/v0.1.0
