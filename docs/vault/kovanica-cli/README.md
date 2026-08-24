# kovanica-cli

A command-line client for the [Kovanica](https://kovanica.online) testnet — a
Rust GHOSTDAG BlockDAG whose token is **KVNC** (8 decimals, 1 KVNC = 10^8
atoms). It talks to the public explorer JSON API and manages a local Ed25519
wallet.

The address encoding (`kvnc…dag`) and spend signing are delegated to
`kovanica-state`, the node's own crate, so the CLI can never drift from the
ledger.

## Install

```sh
cargo build --release
# binary at target/release/kovanica
```

## Global options

- `--api <url>` / `KOVANICA_API` — explorer base URL
  (default `https://explorer.kovanica.online`).

## Commands

### Read-only queries

| Command | Description |
| --- | --- |
| `kovanica head` | Chain head: network, genesis, selected tip, block count, min fee. |
| `kovanica p2p` | p2p listen address, peers, and bootstrap node. |
| `kovanica bootstrap` | Network bootstrap parameters. |
| `kovanica state` | Full node state snapshot. |
| `kovanica blocks` | The blocks in the DAG (the `node.dag` array of `/api/state`). |
| `kovanica balance <address>` | Balance and unspent outputs for an address. |

Addresses may be given as `kvnc…dag` or as 64-hex.

> The node's `/api/blocks` route returns a binary record dump rather than JSON,
> so `blocks` reads the block list out of the JSON `/api/state` snapshot instead.

### Wallet

| Command | Description |
| --- | --- |
| `kovanica keygen [--key <path>] [--force]` | Generate a new Ed25519 key, save it (0600), and print the address. |
| `kovanica address [--key <path>]` | Print the address for a saved key. |

The key file (default `kovanica.key`, override with `--key` or `KOVANICA_KEY`)
stores the 32-byte seed as hex with owner-only permissions. It is a secret —
`.gitignore` excludes `*.key`.

### Send

```sh
kovanica send --key kovanica.key --to <address> --amount <atoms>
```

`send` fetches the transaction's signature hash from the node's `/api/prepare`,
signs those exact bytes locally with the saved key, and broadcasts the 64-byte
signature via `/api/submit`. Amounts are in atoms (1 KVNC = 100000000 atoms).
The node recomputes and re-verifies the spend, so the signature hash is never
trusted from the client — this matches the browser wallet and the node's own
mempool test exactly.

## Example

```sh
kovanica keygen --key alice.key
kovanica balance kvnc…dag
kovanica --api http://127.0.0.1:8080 head
kovanica send --key alice.key --to kvnc…dag --amount 100000000
```

## License

MIT OR Apache-2.0.
