# Kovanica Protocol

**BlockDAG ledger + node + CLI + web UI** — a GHOSTDAG-based distributed ledger where blocks reference multiple parents for parallel production and consensus.

**Default branch: `vps-live`.** This is the protocol running on the public VPS (`kovanica-testnet-1`).

| Service | Host | Component |
| --- | --- | --- |
| Explorer + Node API | `explorer.kovanica.online` | `crates/kovanica-node` (Rust) |
| Web UI (landing, wallet, map) | `kovanica.online` / `wallet.kovanica.online` / `map.kovanica.online` | `web/` (TypeScript) |
| CLI wallet + queries | Local binary `kovanica` | `crates/kovanica-cli` (Rust) |

## What's in this repo

### Rust (Protocol + Node)

**`crates/kovanica-dag`** — the consensus core:
- **Block DAG** with multi-parent blocks and BLAKE3 block ids.
- **GHOSTDAG**: selected parent, mergeset, and k-cluster blue/red colouring.
- **Linearization**: deterministic total order over the whole DAG.
- **Proof-of-work** (Nakamoto-style hash-target, opt-in).
- **Difficulty retargeting**.
- **Reachability oracle**.

**`crates/kovanica-state`** — the UTXO ledger:
- Ed25519 spend signatures.
- GHOSTDAG-ordered apply, snapshots, finality.
- Address encoding (`kvnc…dag`).

**`crates/kovanica-node`** — the node binary:
- Line RPC (`serve` / `demo` / REPL).
- `explorer [addr]`: JSON API + HTML from this process.
- Mempool, TCP gossip, `relay::RelaySession`, `LedgerStore`.

**`crates/kovanica-cli`** — command-line client:
- Read-only explorer queries (`head`, `state`, `balance`, etc.).
- Local Ed25519 wallet (key generation, address derivation).
- Signed transfers (`keygen`, `send`).
- Reuses `kovanica-state` for consistency with the ledger.

### TypeScript (Web UI)

**`web/`** — public web UI:
- Landing page, BlockDAG explorer graph, wallet (create/import/send), origin map.
- TanStack Start + React + TypeScript.
- Proxies to the Rust explorer API for live data.
- VPS: `pm2 kovanica-web` on `127.0.0.1:3010`.

## Run the node

```sh
cargo run -p kovanica-node -- explorer 127.0.0.1:8080
cargo run -p kovanica-node -- demo
cargo run -p kovanica-node           # REPL
```

Interactive REPL example:
```text
> genesis 3 1000 500 1
> send 1 200 2
> pool 2 50 3
> produce
> balance 3
> save ledger.snap
```

## Run the CLI

```sh
cargo build --release -p kovanica-cli
./target/release/kovanica keygen --key alice.key
./target/release/kovanica balance kvnc…dag
./target/release/kovanica send --key alice.key --to kvnc…dag --amount 100000000
```

The CLI defaults to `https://explorer.kovanica.online`; override with `--api` or `KOVANICA_API`.

## Run the web UI (local dev)

```sh
cd web
npm ci
npm run dev
```

VPS rebuild:
```sh
cd web
npm run build:vps
# rsync .output and pm2 restart kovanica-web
```

## Build & test

```sh
cargo build --release
cargo test
```

## Network

Public testnet: **`kovanica-testnet-1`**

- Bootstrap: `seed.kovanica.online:9000`
- Explorer: https://explorer.kovanica.online
- Native token: **KVNC** (8 decimals)

**One P2P path:** plaintext TCP on port **9000** (no libp2p / 30333).

```sh
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000
export KOVANICA_POW=1
export KOVANICA_MINE=0
export KOVANICA_DATA="$PWD/data"

cargo run -p kovanica-node -- explorer 127.0.0.1:8080
```

Open http://127.0.0.1:8080 and verify:
```sh
curl -s http://127.0.0.1:8080/api/head
curl -s https://explorer.kovanica.online/api/head
```

## Deployment

See [deploy/](./deploy/) for VPS nginx + certbot setup and systemd service configs.

## License

Dual-licensed under MIT or Apache-2.0.
