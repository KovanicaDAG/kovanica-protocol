// Network-specific constants and spec text generation
// This file is imported by both network.ts and contract.ts to avoid circular dependencies

export const LIVE_EXPLORER = "https://explorer.kovanica.online";
export const LIVE_WALLET = "https://wallet.kovanica.online";
export const LIVE_MAP = "https://map.kovanica.online";
export const LIVE_SITE = "https://kovanica.online";
export const NETWORK_ID = "kovanica-testnet";
export const MAINNET_ID = "kovanica-mainnet";
// Public-node proxy targets. Mainnet has no live endpoint yet ("launching soon"):
// the URL is left blank until we open it, and selecting it surfaces a clear message.
export const NETWORK_PROXIES: Record<PublicSource, string> = {
  testnet: LIVE_EXPLORER,
  mainnet: "",
};
export const TOKEN = "KVNC";
export const ATOM = 100_000_000;
export const DECIMALS = 8;
export const SUBSIDY = 10 * ATOM;
export const FOUNDER_AMOUNT = 200_000 * ATOM;
export const FOUNDER_SEED = 1;
export const HALVING_ERA = 2_000_000;
export const MAX_SUPPLY = 90_200_000 * ATOM;
// Mirrors the node: min_fee = max(subsidy / 500_000, 1) atoms.
// RFC-006: subsidy = 10 KVNC → min_fee = max(10/500000 * 10^8, 1) = 2000 atoms.
// Note: 500_000 here is the fee-floor divider, not HALVING_ERA (2_000_000).
export const MIN_FEE = Math.max(Math.floor(SUBSIDY / 500_000), 1);
export const K = 3;
export const TREASURY = "cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc";

/** Native KVNC is represented as null / omitted asset_id (RFC-002). */
export type AssetIdHex = string; // 64-char lowercase hex, or empty/null for native

export type LocalSource = "local";
export type PublicSource = "testnet" | "mainnet";
export type ApiSource = LocalSource | PublicSource;

export function isPublicSource(source: ApiSource): source is PublicSource {
  return source === "testnet" || source === "mainnet";
}

export function isNativeAsset(assetId: string | null | undefined): boolean {
  return !assetId || assetId === "0".repeat(64);
}

export function assetLabel(assetId: string | null | undefined): string {
  if (isNativeAsset(assetId)) return TOKEN;
  return `${assetId!.slice(0, 8)}…`;
}

export type ApiOutput = {
  value: number;
  owner: string;
  /** RFC-002: omitted or null = native KVNC */
  asset_id?: string | null;
};
export type ApiTx = {
  id: string;
  coinbase: boolean;
  inputs: number;
  outputs: ApiOutput[];
};
export type ApiDagBlock = {
  id: string;
  parents: string[];
  selected_parent: string | null;
  work: number;
  timestamp_ms: number;
  nonce: number;
  blue_score: number;
  colour: "genesis" | "chain" | "blue" | "red";
  txs: ApiTx[];
};
export type ApiUtxo = {
  tx: string;
  index: number;
  value: number;
  /** RFC-002: omitted or null = native KVNC */
  asset_id?: string | null;
  /** KVP-106: asset kind */
  kind?: "fungible" | "nft";
  /** KVP-106: metadata hash for NFTs */
  metadata_hash?: string | null;
  /** KVP-106: collection ID for NFTs */
  collection_id?: string | null;
};
export type ApiHistoryTx = {
  block: string;
  tx: string;
  kind: "coinbase" | "in" | "out" | "faucet";
  delta: number;
  /** RFC-002: omitted or null = native KVNC */
  asset_id?: string | null;
  /** KVP-106: asset kind */
  asset_kind?: "fungible" | "nft";
  /** KVP-106: metadata hash for NFTs */
  metadata_hash?: string | null;
  /** KVP-106: collection ID for NFTs */
  collection_id?: string | null;
};
export type ApiNode = {
  blocks: number;
  tips: string[];
  selected_tip: string;
  blue_score: number;
  blue_work: number;
  k: number;
  subsidy: number;
  issuance: number;
  halving_era: number;
  min_fee: number;
  genesis: string;
  supply: number;
  token: string;
  decimals: number;
  miner: string;
  atom: number;
  ui: string;
  utxos: number;
  chain_len: number;
  mempool: number;
  tx_count: number;
  dag: ApiDagBlock[];
  order: string[];
  pending: string[];
};
export type ApiState = {
  selected: string;
  mining: boolean;
  faucet: boolean;
  allow_reset: boolean;
  operator: boolean;
  network: string;
  listen: string;
  peers: string[];
  mesh: {
    now: number;
    queued: number;
    nodes: { name: string; blocks: number; tip: string; peers: string[]; mempool: number }[];
    events: { at: number; from: string; to: string; kind: string }[];
  };
  node: ApiNode;
  wallets: { seed: number; address: string; balance: number }[];
  source?: ApiSource;
};
export type ApiHead = {
  network: string;
  genesis: string;
  tip: string;
  blocks: number;
  min_fee: number;
  atom: number;
  finality_depth: number;
};
export type ApiBootstrap = {
  network: string;
  genesis: string;
  tip: string;
  admission: string;
  poa_enabled: boolean;
  atom: number;
  token: string;
  k: number;
  subsidy: number;
  min_fee: number;
  finality_depth: number;
  block_pruning_depth: number;
  payload_pruning_depth: number;
  founder_amount: number;
  founder_seed: number;
  max_supply: number;
  burned: number;
  circulating: number;
  native_minted: number;
  total: number;
  listen: string;
  peers: string[];
  operator_wallet_address?: string;
  light_config?: unknown;
  source?: ApiSource;
  upstream?: { ok: true; head: ApiHead } | { ok: false; error: string };
};
export type ApiUtxos = {
  address: string;
  /** Native KVNC balance only (RFC-002) */
  balance: number;
  utxos: ApiUtxo[];
  /** Per-asset balances when node supports RFC-002 */
  balances?: { asset_id: string | null; balance: number }[];
};
export type ApiHistory = {
  address: string;
  balance: number;
  txs: ApiHistoryTx[];
};
export type ApiPrepare = {
  ok: true;
  sighash: string;
  value: number;
  fee: number;
  change: number;
  outpoint: { tx: string; index: number };
  /** Echo of requested asset (null = native) */
  asset_id?: string | null;
};
export type ApiSubmit = { ok: true; tx: string };
export type ApiOrigins = { pulses: { iso3: string; pulses: number }[] };
export const READ_PATHS = [
  "head",
  "bootstrap",
  "state",
  "utxos",
  "history",
  "origins",
  "spec",
  "p2p",
] as const;
export const WRITE_PATHS = [
  "prepare",
  "submit",
  "produce",
  "faucet",
  "mine",
  "miner",
  "mining",
  "reset",
  "fee_estimate",
] as const;

export type ReadOnlyPaths = (typeof READ_PATHS)[number];
export type WriteOnlyPaths = (typeof WRITE_PATHS)[number];

/**
 * Returns the spec text for the given network.
 * This function generates the spec text based on the network-specific constants.
 */
export function getSpecText(network: PublicSource): string {
  const isMainnet = network === "mainnet";
  const liveExplorer = isMainnet ? "" : "https://explorer.kovanica.online";
  const liveWallet = isMainnet ? "" : "https://wallet.kovanica.online";
  const liveMap = isMainnet ? "" : "https://map.kovanica.online";
  const liveSite = isMainnet ? "" : "https://kovanica.online";
  const networkId = isMainnet ? MAINNET_ID : NETWORK_ID;
  const upstreamMessage = isMainnet
    ? "mainnet launching soon"
    : "https://explorer.kovanica.online";

  return `# ${networkId}

Public BlockDAG ${isMainnet ? "mainnet" : "testnet"}. Native token **${TOKEN}** (8 decimals).
Engine is the Rust node; this app speaks the same HTTP contract.

||| | |
||| --- | --- |
||| Explorer | ${liveExplorer} ||
||| Wallet | ${liveWallet} ||
||| Map | ${liveMap} ||
||| Site | ${liveSite} ||
||| Network | \`${networkId}\` ||
||| Premine | ${FOUNDER_AMOUNT / ATOM} KVNC (founder / treasury) ||
||| Subsidy cap | ${SUBSIDY / ATOM} KVNC / block, halves every ${HALVING_ERA.toLocaleString()} blocks ||
||| Hard cap | ${MAX_SUPPLY / Number(ATOM.toLocaleString().replace(/,/g, ''))} KVNC (90.2M) ||
||| Min fee | ${MIN_FEE} atoms (${MIN_FEE / ATOM} KVNC) — burned ||
||| k | ${K} (GHOSTDAG) ||
||| Atom | 1 KVNC = 10^8 atoms ||
||| Finality depth | 100 blue score ||
||| Payload pruning | 1000 blue score ||

## HTTP API (this app + live explorer)

All JSON. Errors are plain text with 4xx. The default (and \`\`?source=${network === "testnet" ? "testnet" : "mainnet"}\`\`,
or header \`\`x-kovanica-source: ${network === "testnet" ? "testnet" : "mainnet"}\`\`) proxies the public ${network === "testnet" ? "testnet" : "mainnet"} node.
Request \`\`?source=local\` to hit this app's local in-memory node; \`\`?source=${network === "testnet" ? "mainnet" : "testnet"}\`\
is reserved for the not-yet-open ${network === "testnet" ? "mainnet" : "testnet"}.

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
  ${network === "testnet" ? "testnet open faucet. kind=faucet (default). Per-address lifetime cap: 5 KVNC." : "mainnet faucet (closed)"}

POST /api/reset
  local only (chain wipe is locked on the public testnet)

POST /api/origin?iso3=HRV
  pulse a country (ISO 3166-1 alpha-3)

## Wallet

Address = Ed25519 public key (64 hex) or kvnc…dag (versioned + base58).
BIP44 path: m/44'/3007'/account'/change/index (coin type 3007, unregistered).
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
  KOVANICA_MINE=0 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0 \\\\
  KOVANICA_OPERATOR=0 KOVANICA_POW=1 \\\\
  KOVANICA_LISTEN=0.0.0.0:9000 \\\\
  KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \\\\
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
}