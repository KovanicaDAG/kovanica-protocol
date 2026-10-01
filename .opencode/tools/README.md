# Custom Tools for OpenCode (Kovanica)

The custom tools are now registered by the `kovanica.tools` V2 plugin (`.opencode/plugins/tools/`) via `ctx.tool.transform` — this directory is kept as documentation only. All tools are pure/local or hit only public Kovanica endpoints/local disk — none require secrets.

| Tool | What it does |
|---|---|
| `head` | Fetch `/api/head`, local node first then public explorer fallback |
| `bootstrap` | Fetch `/api/bootstrap` from an explorer |
| `supply-calc_subsidyAt`, `_feeFloor`, `_maturityCheck`, `_capCheck` | Local RFC-006 emission math — no network needed |
| `tx-lint` | Shape-check an Ed25519 signature/pubkey hex string (length/charset only) |
| `seed-lint` | Lint an env/peer block for orange-cloud seeds, ALLOW_RESET/FAUCET/OPERATOR, missing KOVANICA_DATA, possible key-material leakage |
| `skill-writer` | Create/overwrite a `SKILL.md` on disk (project or global scope) — the write side of the self-creating `skill-forge` skill |
| `usage-log_record`, `_summary` | Append to / summarize the usage log (now stored via `ctx.storage`, key `usage.log`) |
| `changelog-gen` | Draft a grouped changelog between two git refs (consensus-safe / ledger-safe / client-only via commit subject tags) |

The `kovanica.tools` plugin also registers:
- the `kovanica-dag` MCP server (`.opencode/mcp/kovanica-dag-server.mjs`) exposing `head` / `bootstrap` / `prepare` over stdio JSON-RPC, and
- an isolated-node worktree (`kovanica-isolated-node`) for spinning up testnet nodes without touching the main checkout.

Add more as needed — e.g. a real HTTP client for `/api/prepare` once you want the agent to build (not just review) transactions.