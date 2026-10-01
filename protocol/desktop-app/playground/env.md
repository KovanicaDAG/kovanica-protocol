# Environment Variables (documented per AGENTS.md rules)

Every env var used by desktop-app / node / deploy must be documented.

| Var | Value / Default | Safety note |
|---|---|---|
| `KOVANICA_DATA` | `$PWD/data` (preserve after genesis) | Never delete after first genesis write |
| `KOVANICA_POW` | `1` (deprecated; PoA replaces) | Target-for-removal |
| `KOVANICA_MINE` | `0` (participant default) | Must stay `0` unless operator |
| `KOVANICA_MINE_SECS` | `120` | Only with `KOVANICA_MINE=1` |
| `KOVANICA_FAUCET` | `0` | Never open on public nodes |
| `KOVANICA_ALLOW_RESET` | `0` | Never `1` on public-facing nodes |
| `KOVANICA_OPERATOR` | `0` (default) | `1` only for authority nodes |
| `KOVANICA_LISTEN` | `0.0.0.0:9000` | Plaintext TCP 9000 only |
| `KOVANICA_PEERS` | `seed.kovanica.online:9000` | DNS-only; never explorer hostname |
| `KOVANICA_CONSENSUS` | `poa` | Ratified 2026-09-25 |
| `KOVANICA_AUTHORITIES` | authority conf | PoA operator matrix |
| `KOVANICA_AUTHORITY_THRESHOLD` | threshold | PoA consensus gate |
| `KOVANICA_SLOT_DURATION` | slot duration ms | Authority slot cadence |

Private keys (`KVNC.pem`) stay client-side. The node never receives seeds.
