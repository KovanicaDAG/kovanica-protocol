import {
  ATOM,
  FOUNDER_AMOUNT,
  HALVING_ERA,
  K,
  LIVE_EXPLORER,
  LIVE_KOVI,
  LIVE_MAP,
  LIVE_SITE,
  LIVE_WALLET,
  MAX_SUPPLY,
  MIN_FEE,
  NETWORK_ID,
  SUBSIDY,
  TOKEN,
} from "./contract";

export const SPEC_TEXT = `# ${NETWORK_ID}

Public BlockDAG testnet. Native token **${TOKEN}** (8 decimals).
Engine is the Rust node; this app speaks the same HTTP contract.

|| | |
|| --- | --- |
|| Explorer | ${LIVE_EXPLORER} |
|| Wallet | ${LIVE_WALLET} |
|| Map | ${LIVE_MAP} |
|| Kovi | ${LIVE_KOVI} |
|| Site | ${LIVE_SITE} |
|| Network | \`${NETWORK_ID}\` |
|| Premine | ${FOUNDER_AMOUNT / ATOM} KVNC (founder / treasury) |
|| Subsidy cap | ${SUBSIDY / ATOM} KVNC / block, halves every ${HALVING_ERA.toLocaleString()} blocks |
|| Hard cap | ${MAX_SUPPLY / Number(ATOM.toLocaleString().replace(/,/g, ''))} KVNC (90.2M) |
|| Min fee | ${MIN_FEE} atoms (${MIN_FEE / ATOM} KVNC) — burned |
|| k | ${K} (GHOSTDAG) |
|| Atom | 1 KVNC = 10^8 atoms |
|| Finality depth | 100 blue score |
|| Payload pruning | 1000 blue score |

## HTTP API (this app + live explorer)

All JSON. Errors are plain text with 4xx. The default (and \`?source=testnet\`,
or header \`x-kovanica-source: testnet\`) proxies the public testnet node.
Request \`?source=local\` to hit this app's local in-memory node; \`?source=mainnet\`
is reserved for the not-yet-open mainnet.

### Read

GET /api/head
  { network, genesis, tip, blocks, min_fee, atom }

GET /api/bootstrap
  head + { listen, peers, pow, token, k, subsidy, founder_amount, founder_seed, source, upstream }
  + finality_depth, payload_pruning_depth

GET /api/state
  full DAG, mempool, flags (faucet / operator / mining), mesh

GET /api/utxos?address=<64-hex or kvnc…dag>
  { address, balance, utxos: [{ tx, index, value }] }

GET /api/history?address=<64-hex or kvnc…dag>
  { address, balance, txs: [{ block, tx, kind, delta }] }

GET /api/origins
  { pulses: [{ iso3, pulses }] }

GET /api/spec
  this document (text/plain)

GET /api/p2p
  { path: "tcp", listen, peers, bootstrap } — Rust node only

GET /api/blocks
  octet-stream dump of every block (same bytes a clone pulls on :9000)

GET /api/download/install.sh
  node installer script (Linux x64/arm64)

GET /download/kovanica-node-linux-x64
  Linux x64 binary

GET /download/kovanica-node-linux-arm64
  Linux arm64 binary

### Write

POST /api/prepare?from=&to=&amount=&fee=
  pick a covering UTXO; returns { sighash, value, fee, change, outpoint }
  the node never sees the seed — sign sighash bytes in the browser (Ed25519)

POST /api/submit?from=&to=&amount=&sig=&fee=
  queue the signed transfer. sig is 64-byte Ed25519 (128 hex) over sighash

POST /api/produce
  pack mempool into a block (400 if empty)

POST /api/fee_estimate?amount=
  mempool fee estimate in atoms: p90 of pending fees, min-fee when empty;
  amounts over 1 KVNC scale by 1.2

POST /api/mine
  operator: append one block (pack mempool, else empty coinbase)

POST /api/mining?on=1
  operator: start/stop auto-mine on the selected node

POST /api/miner?addr=
  operator: set coinbase payee

POST /api/faucet?to=&amount=
  testnet open faucet. kind=faucet (default). Per-address lifetime cap: 5 KVNC.

POST /api/reset
  local only (chain wipe is locked on the public testnet)

POST /api/origin?iso3=HRV
  pulse a country (ISO 3166-1 alpha-3)

## Wallet

Address = Ed25519 public key (64 hex) or kvnc…dag (versioned + base58).
BIP44 path: m/44'/999'/account'/change/index (coin type 999, unregistered).
Browser signs prepare's sighash; submit never receives the mnemonic.
Faucet stays off on the public explorer. Hardware: Ledger (WebHID) + Trezor (WebUSB).

## Line RPC (Rust node stdin)

The GitHub crate still exposes a REPL, not HTTP:

  genesis <k> <subsidy> <amount> <seed>
  genesis_finality <k> <subsidy> <amount> <seed> <finality_depth>
  address <seed> | balance <seed|addr-hex>
  send <from> <amount> <to> | pool … | produce | pending
  tips | tip | len | origin [ISO3] | origins
  save <path> | load <path> | checkpoint | load_checkpoint
  faucet | faucet_to <addr> | faucet_cap | faucet_status
  mining [on|off] | produce | miner <addr>
  vrf <prove|verify> … | staking [vrf-pk-hex]

HTTP above is what explorer.kovanica.online actually serves.
Live CORS is closed — this app proxies it server-side.

## Run a public node

  cargo build --release -p kovanica-node
  KOVANICA_MINE=0 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0 \\
  KOVANICA_OPERATOR=0 KOVANICA_POW=1 \\
  KOVANICA_LISTEN=0.0.0.0:9000 \\
  KOVANICA_PEERS=seed.kovanica.online:9000,seed3.kovanica.online:9000 \\
  ./target/release/kovanica-node explorer 127.0.0.1:8080

TCP :9000 is the only P2P path. Do not set peers to explorer.kovanica.online:9000
— that name is Cloudflare-proxied and never reaches the seed. Use a DNS-only
A record (seed.kovanica.online) or the origin IP.
After sync, GET /api/head on the clone matches the public genesis (and tip, once
the seed has served its blocks).

## Live explorer downloads

GET /download/kovanica-wallet-apk
  Android APK (debug-signed, v0.1)

GET /download/kovanica-wallet-ios-ipa
  iOS IPA (sideload, v0.1)

GET /download/kovanica-node-linux-x64
GET /download/kovanica-node-linux-arm64
GET /download/install.sh
  Node binaries + installer; GitHub Actions builds on every relevant push.
`;

