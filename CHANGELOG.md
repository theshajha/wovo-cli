# Changelog

All notable changes to the `wovo` package are documented here. This project
adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [Unreleased]

## [0.2.0]

### Added

- **`wovo watch <file|dir>`** — auto-publish on every save. The deterministic
  sync path: an exported design (e.g. from Pencil) lands once it's written, so
  nothing depends on an agent remembering to deploy. Private by default, survives
  atomic saves, with a configurable settle window (`--debounce`, default 3s), a
  maxWait cap, and flush-on-exit so the last save is never dropped.
- **Non-HTML guard** — `wovo deploy not-a-page.json` now fails fast with a clear
  message instead of uploading a non-HTML file.

### Changed

- **Deploy defaults to `private`** (was public-by-link), matching the MCP/agent
  default so both paths behave identically. Add `--access public` to publish a
  shareable link. *(Behavior change — review scripts that relied on public deploys.)*
- **Unmissable live link.** Single-page deploys and every `watch` save print a
  receipt with the live link on its own line; the MCP `wovo_deploy` result leads
  with the link and tells the agent to end its reply with it — so it never gets
  lost in a wall of output.
- **Skill trigger tightened** so agents reliably recognize a finished HTML page
  as publishable, instruct ending the reply with the link, point heavy savers to
  `wovo watch`, and recover from auth errors (`wovo setup`). Setup's welcome page
  and the CLI mark now use the current `w.` brand.

### Fixed

- **Network resilience** — every API call now has a 30s timeout and one retry on
  transient failures, so a flaky connection no longer hangs the CLI/MCP forever.
- **Actionable errors** — 401/403 tell you to run `wovo setup`; 429 explains the
  rate limit, instead of a bare HTTP status.

## [0.1.7]

### Added

- **`wovo pages rename <slug> <new>`** — change a page's path; old links
  308-redirect and linked custom domains follow. MCP tool: `wovo_pages_rename`.
- **`wovo setup --scope project|user`** — install for this project only
  (default) or for every project on this machine (user-level skill + MCP).
- **`wovo setup --behavior auto|ask|manual`** — choose how the agent publishes
  finished HTML: automatically (default), offer first, or only when asked.

### Fixed

- Browser sign-in now stores the workspace slug, and every command falls back
  to the token's own workspace server-side — `wovo list` / `pages` / `domains`
  no longer target a workspace literally named "default" after `wovo setup`.

## [0.1.6]

### Added

- **`wovo pages`** — archive, unarchive, and move pages via `/api/pages` PATCH:
  `archive <slug>`, `unarchive <slug>`, `move <slug> --space <name>`.
- MCP tools: `wovo_pages_archive`, `wovo_pages_unarchive`, `wovo_pages_move`.

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

[Unreleased]: https://github.com/theshajha/wovo-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/theshajha/wovo-cli/compare/v0.1.7...v0.2.0
[0.1.0]: https://github.com/theshajha/wovo-cli/releases/tag/v0.1.0
