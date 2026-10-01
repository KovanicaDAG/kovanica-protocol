# Kovanica OpenCode Plugins

Three plugins provide Kovanica-specific automation and safety:

## `kovanica.guards` (`.opencode/plugins/guards/`)
**Safety enforcement at the tool layer:**
- Blocks unsafe `KOVANICA_*` env vars (`ALLOW_RESET=1`, `FAUCET=1`, `OPERATOR=1`)
- Blocks orange-cloud seed hostnames (`explorer.kovanica.online:9000`)
- Blocks private key/seed material in commands
- Git release hazard guards:
  - Force push to protected branches (`main`, `master`, `release`)
  - Tag deletion
  - Hard reset on protected branches
- `permission.evaluate` hook denies read/edit on `.env`, `*.key`, `*.pem`, wallet files

## `kovanica.tools` (`.opencode/plugins/tools/`)
**Registers custom tools + MCP server + isolated worktree:**
- Custom tools (also available via MCP): `head`, `bootstrap`, `supply-calc_*`, `tx-lint`, `seed-lint`, `skill-writer`, `usage-log_*`, `changelog-gen`
- MCP server: `kovanica-dag` (stdio JSON-RPC) exposing `head`, `bootstrap`, `prepare`
- Isolated-node worktree: `kovanica-isolated-node` for testnet nodes without touching main checkout

## `kovanica.automation` (`.opencode/plugins/automation/`)
**Event-driven automation:**
- Usage tracking → `ctx.storage` key `usage.log` (from `session.step.ended`)
- Auto-skill-suggester → notifies after 3+ repeated tool patterns
- Compact-reminder → every 20 steps
- Consensus/clippy reminders → after dag/state edits
- Session summary → on `session.ended`

## Installation
Plugins are auto-loaded via `opencode.json`:
```json
"plugins": [
  "./.opencode/plugins/guards",
  "./.opencode/plugins/tools",
  "./.opencode/plugins/automation"
]
```