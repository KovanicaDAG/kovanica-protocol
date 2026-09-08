/** HTTP contract shared with explorer.kovanica.online (kovanica-testnet). */

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
export const SUBSIDY = 200 * ATOM;
export const FOUNDER_AMOUNT = 200 * ATOM;
export const FOUNDER_SEED = 1;
export const HALVING_ERA = 500_000;
export const MIN_FEE = 10_000;
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
};
export type ApiHistoryTx = {
  block: string;
  tx: string;
  kind: "coinbase" | "in" | "out" | "faucet";
  delta: number;
  /** RFC-002: omitted or null = native KVNC */
  asset_id?: string | null;
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
  pow: boolean;
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
    events: string[];
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
};
export type ApiBootstrap = ApiHead & {
  listen: string;
  peers: string[];
  pow: boolean;
  token: string;
  k: number;
  subsidy: number;
  founder_amount: number;
  founder_seed: number;
  source?: ApiSource;
  upstream?: { ok: true; head: ApiHead } | { ok: false; error: string };
  finality_depth?: number;
  payload_pruning_depth?: number;
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
  "origin",
  "fee_estimate",
] as const;
