import {
  ATOM,
  HALVING_ERA,
  K,
  LIVE_EXPLORER,
  LIVE_MAP,
  LIVE_SITE,
  LIVE_WALLET,
  MIN_FEE,
  NETWORK_ID,
  SUBSIDY,
  TOKEN,
} from "./contract";

export const SPEC_TEXT = `# ${NETWORK_ID}

Public BlockDAG testnet. Native token **${TOKEN}** (8 decimals).
Engine is the Rust node; this app speaks the same HTTP contract.

| | |
| --- | --- |
| Explorer | ${LIVE_EXPLORER} |
| Wallet | ${LIVE_WALLET} |
| Map | ${LIVE_MAP} |
| Site | ${LIVE_SITE} |
| Network | \`${NETWORK_ID}\` |
| Premine | 50 KVNC (founder / treasury) |
| Subsidy cap | ${SUBSIDY / ATOM} KVNC / block, halves every ${HALVING_ERA} blocks |
| Min fee | ${MIN_FEE} atoms (0.0001 KVNC) — burned |
| k | ${K} (GHOSTDAG) |
| Atom | 1 KVNC = 10^8 atoms |

## HTTP API (this app + live explorer)

All JSON. Errors are plain text with 4xx. Query \`source=live\` (or header
\`x-kovanica-source: live\`) proxies the public node. Default is the preview node.

### Read

GET /api/head
  { network, genesis, tip, blocks, min_fee, atom }

GET /api/bootstrap
  head + { listen, peers, pow, token, k, source, upstream }

GET /api/state
  full DAG, mempool, flags (faucet / operator / mining), mesh

GET /api/utxos?address=<64-hex>
  { address, balance, utxos: [{ tx, index, value }] }

GET /api/history?address=<64-hex>
  { address, balance, txs: [{ block, tx, kind, delta }] }

GET /api/origins
  { pulses: [{ iso3, pulses }] }

GET /api/spec
  this document (text/plain)

GET /api/p2p
  { path: "tcp", listen, peers, bootstrap } — Rust node only

GET /api/blocks
  octet-stream dump of every block (same bytes a clone pulls on :9000)


### Write

POST /api/prepare?from=&to=&amount=
  pick a covering UTXO; returns { sighash, value, fee, change, outpoint }
  the node never sees the seed — sign sighash bytes in the browser (Ed25519)

POST /api/submit?from=&to=&amount=&sig=
  queue the signed transfer. sig is 64-byte Ed25519 (128 hex) over sighash

POST /api/produce
  pack mempool into a block (400 if empty)

POST /api/mine
  operator: append a coinbase block (preview on, live off)

POST /api/mining?on=1
  operator: start/stop auto-mine (preview on, live off)

POST /api/miner?addr=
  operator: set coinbase payee

POST /api/faucet?to=&amount=&kind=
  preview mint (live 403). kind=tap|faucet (default faucet). kind=tap is Preview only.

POST /api/reset
  preview only

POST /api/origin?iso3=HRV
  pulse a country (ISO 3166-1 alpha-3)

## Wallet

Address = Ed25519 public key (64 hex), seed = SHA-256(mnemonic|index|kovanica-wallet-v2).
Browser signs prepare's sighash; submit never receives the 12 words.
Faucet and tap-mint stay off on the public explorer.

## Line RPC (Rust node stdin)

The GitHub crate still exposes a REPL, not HTTP:

  genesis <k> <subsidy> <amount> <seed>
  address <seed> | balance <seed|addr-hex>
  send <from> <amount> <to> | pool … | produce | pending
  tips | tip | len | origin [ISO3] | origins
  save <path> | load <path>

HTTP above is what explorer.kovanica.online actually serves.
Live CORS is closed — this app proxies it server-side.

## Run a public node

  cargo build --release -p kovanica-node
  KOVANICA_MINE=0 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0 \\
  KOVANICA_OPERATOR=0 KOVANICA_POW=1 \\
  KOVANICA_LISTEN=0.0.0.0:9000 \\
  KOVANICA_PEERS=seed.kovanica.online:9000 \\
  ./target/release/kovanica-node explorer 127.0.0.1:8080

TCP :9000 is the only P2P path. Do not set peers to explorer.kovanica.online:9000
— that name is Cloudflare-proxied and never reaches the seed. Use a DNS-only
A record (seed.kovanica.online) or the origin IP.
After sync, GET /api/head on the clone matches the public genesis (and tip, once
the seed has served its blocks).
`;

