# Environment Variables (documented per AGENTS.md rules)

Every env var used by desktop-app / node / deploy must be documented.

| Var | Value / Default | Safety note |
|---|---|---|
| `KOVANICA_DATA` | `$PWD/data` (preserve after genesis) | Never delete after first genesis write |
| `KOVANICA_CONSENSUS` | `poa` | Ratified 2026-09-25; defaults to `poa` when unset |
| `KOVANICA_AUTHORITIES` | authority conf | Comma-separated 32-byte hex pubkeys; testnet has placeholder |
| `KOVANICA_AUTHORITY_THRESHOLD` | strict majority | M-of-N threshold for AuthorityUpdateTx |
| `KOVANICA_SLOT_DURATION` | `3000` | PoA slot duration in ms |
| `KOVANICA_AUTHORITY_KEY` | (unset) | 32-byte hex secret; set via EnvironmentFile (mode 0600) |
| `KOVANICA_FAUCET` | `0` | Never open on public nodes |
| `KOVANICA_ALLOW_RESET` | `0` | Never `1` on public-facing nodes |
| `KOVANICA_OPERATOR` | `0` (default) | `1` only for authority/explorer nodes |
| `KOVANICA_LISTEN` | `0.0.0.0:9000` | Plaintext TCP 9000 only |
| `KOVANICA_PEERS` | `seed2.kovanica.online:8000,seed3.kovanica.online:8000` | DNS-only; never explorer hostname |
| `KOVANICA_NETWORK` | `kovanica-testnet` | Network profile selector |

Private keys stay client-side. The node never receives seeds.
