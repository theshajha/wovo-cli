# Changelog

All notable changes to the `wovo` package are documented here. This project
adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [Unreleased]

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
