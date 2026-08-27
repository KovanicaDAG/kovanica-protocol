/** HTTP contract shared with explorer.kovanica.online (kovanica-testnet-1). */

export const LIVE_EXPLORER = "https://explorer.kovanica.online";
export const LIVE_WALLET = "https://wallet.kovanica.online";
export const LIVE_MAP = "https://map.kovanica.online";
export const LIVE_SITE = "https://kovanica.online";
export const NETWORK_ID = "kovanica-testnet-1";
export const TOKEN = "KVNC";
export const ATOM = 100_000_000;
export const DECIMALS = 8;
export const SUBSIDY = 50 * ATOM;
export const HALVING_ERA = 1000;
export const MIN_FEE = 10_000;
export const K = 3;
export const TREASURY = "cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc";

export type ApiSource = "local" | "live";

export type ApiOutput = { value: number; owner: string };
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
export type ApiUtxo = { tx: string; index: number; value: number };
export type ApiHistoryTx = {
  block: string;
  tx: string;
  kind: "coinbase" | "in" | "out" | "faucet" | "tap";
  delta: number;
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
  source?: ApiSource;
  upstream?: { ok: true; head: ApiHead } | { ok: false; error: string };
};
export type ApiUtxos = { address: string; balance: number; utxos: ApiUtxo[] };
export type ApiHistory = { address: string; balance: number; txs: ApiHistoryTx[] };
export type ApiPrepare = {
  ok: true;
  sighash: string;
  value: number;
  fee: number;
  change: number;
  outpoint: { tx: string; index: number };
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
] as const;

export const WRITE_PATHS = [
  "prepare",
  "submit",
  "produce",
  "faucet",
  "tap",
  "mine",
  "miner",
  "mining",
  "reset",
  "origin",
] as const;
