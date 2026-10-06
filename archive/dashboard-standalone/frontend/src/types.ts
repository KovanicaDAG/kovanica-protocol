// Kovanica API Types - matches node API surface

export interface ApiHead {
  network: string;
  net?: string; // Legacy field
  genesis: string;
  tip: string;
  blocks: number;
  min_fee: number;
  atom: number;
  // RFC-006 supply. The node emits these as `native_minted` / `circulating` /
  // `burned` / `max_supply` on /api/bootstrap; `normalizeSupply` in hooks/useApi
  // aliases the unprefixed spellings onto the canonical native_* names.
  native_minted?: number;
  native_total?: number;
  native_circulating?: number;
  native_burned?: number;
  native_max_supply?: number;
  circulating?: number;
  burned?: number;
  max_supply?: number;
  subsidy?: number;
  blue_score?: number;
  k?: number;
}

export interface ApiBootstrap extends ApiHead {
  listen: string;
  peers: string[];
  token: string;
  k: number;
  subsidy: number;
  founder_amount: number;
  founder_seed: string;
  source?: string;
  upstream?: { ok: true; head: ApiHead } | { ok: false; error: string };
  finality_depth?: number;
  payload_pruning_depth?: number;
  authorities?: string[];
  authority_threshold?: number;
  slot_duration?: number;
}

export interface ApiOutput {
  address: string;
  value: number;
  asset_id: string | null;
  script_version: number;
  script_pubkey: string;
}

export interface ApiTx {
  id: string;
  version: number;
  inputs: Array<{ outpoint: { tx: string; index: number }; signature: string }>;
  outputs: ApiOutput[];
  lock_time: number;
  size: number;
  fee: number;
}

/** One output of a DAG transaction, as the node reports it. */
export interface ApiDagTxOutput {
  value: number;
  owner: string;
}

/** A transaction embedded in a DAG block. */
export interface ApiDagTx {
  id: string;
  coinbase: boolean;
  inputs: number;
  outputs: ApiDagTxOutput[];
}

/**
 * A DAG vertex as the node actually reports it.
 *
 * The block's position in the chain is its index in `node.order` — the node does
 * not emit a per-block `height`. Chain height is available separately as
 * `state.node.chain_len`. The timestamp field is `timestamp_ms` (milliseconds,
 * not seconds), and blue/red is reported as `colour`.
 */
export interface ApiDagBlock {
  id: string;
  parents: string[];
  selected_parent: string | null;
  blue_score: number;
  /** "genesis" | "blue" | "red" */
  colour: string;
  timestamp_ms: number;
  nonce: number;
  work: number;
  txs: ApiDagTx[];
}

/**
 * A single unspent output as the node actually reports it.
 *
 * The node returns a FLAT shape (tx + index + value at the top level), not the
 * nested `outpoint`/`output` nesting a reader might assume. The address is
 * echoed back in hex even when a `kvnc…dag` address was queried.
 */
export interface ApiUtxo {
  tx: string;
  index: number;
  value: number;
  /** Native KVNC is the literal "KVNC", not null. */
  asset_id: string | null;
  kind: string | null;
  metadata_hash: string | null;
  collection_id: string | null;
}

export interface ApiUtxos {
  address: string;
  /** Native balance in atoms. */
  balance: number;
  /** Per-asset balances, keyed by asset id. */
  balances?: Record<string, number>;
  utxos: ApiUtxo[];
  limit?: number;
  offset?: number;
  total?: number;
}

/** One address-history event, matching the node's flat event shape. */
export interface ApiHistoryTx {
  block: string;
  tx: string;
  /** "coinbase", "send", "receive", … */
  kind: string;
  /** Signed atom delta — positive for received, negative for sent. */
  delta: number;
  asset_id: string | null;
  asset_kind: string | null;
  metadata_hash: string | null;
  collection_id: string | null;
}

export interface ApiHistory {
  address: string;
  balance: number;
  balances?: Record<string, number>;
  txs: ApiHistoryTx[];
  limit?: number;
  offset?: number;
  total?: number;
}

export interface ApiNode {
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
  atom: number;
  ui: string;
  utxos: number;
  chain_len: number;
  mempool: number;
  tx_count: number;
  // PoA authority public key of the local node (KVP-101/authority.rs). This is
  // the producer identity. There is NO `miner` field — an older revision of this
  // interface declared one and panels rendered "—" forever because tsc cannot
  // catch a field that is declared-but-never-sent. See scripts/api-contract.ts.
  // Kept for backwards compatibility with old panels.
  miner?: string;
  authority_pk?: string;
  admission?: string;
  poa_enabled?: boolean;
  // RFC-006 supply, as emitted by the node alongside `native_minted`.
  circulating?: number;
  burned?: number;
  max_supply?: number;
  dag: ApiDagBlock[];
  order: string[];
  pending: string[];
}

export interface MeshNode {
  name: string;
  blocks: number;
  tip: string;
  peers: number;
  mempool: number;
}

export interface MeshEvent {
  at: string;
  from: string;
  to: string;
  kind: string;
}

export interface MeshState {
  now: number;
  queued: number;
  nodes: MeshNode[];
  events: MeshEvent[];
}

export interface ApiState {
  selected: string;
  allow_reset: boolean;
  operator: boolean;
  network: string;
  listen: string;
  peers: string[];
  mesh: MeshState;
  node: ApiNode;
  wallets: Array<{ seed: number; address: string; balance: number }>;
  source?: string;
}

/**
 * PoA authority set as reported by `GET /api/network`.
 *
 * This is the ONLY endpoint that carries the authority surface — `/api/bootstrap`
 * returns `authority_set: null`, so anything reading the set from bootstrap
 * silently sees nothing.
 */
export interface ApiAuthoritySet {
  authorities: string[];
  threshold: number;
  count: number;
  hash: string;
}

/** `GET /api/network` — network identity, PoA authority set and slot clock. */
export interface ApiNetwork {
  network: string;
  genesis: string;
  tip: string;
  blue_score: number;
  peers: string[];
  authority_set: ApiAuthoritySet | null;
  current_slot: number;
  slot_duration_ms: number;
  time_to_next_slot_ms: number;
  next_slot_timestamp_ms: number;
}

export interface ApiAddress {
  address: string;
  balance: number;
  utxos: ApiUtxo[];
  txs: ApiHistoryTx[];
  page: number;
  per_page: number;
  total: number;
}

export interface ApiNft {
  id: string;
  collection_id: string;
  owner: string;
  metadata_uri: string;
  metadata_hash: string;
  mint_height: number;
  mint_txid: string;
}

export interface ApiCollection {
  id: string;
  name: string;
  symbol: string;
  creator: string;
  total_supply: number;
  minted: number;
  royalty_bps: number;
  metadata_uri: string;
}

export interface ApiToken {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  total_supply: number;
  minted: number;
  owner: string;
  is_nft: boolean;
}

export interface ApiDexToken {
  asset_id: string;
  symbol: string;
  name: string;
  decimals: number;
  reserve_kvnc: number;
  reserve_asset: number;
  price_kvnc: number;
  volume_24h: number;
}

export interface FeeEstimate {
  slow: number;
  normal: number;
  fast: number;
}

export interface WsBlockMsg {
  type: 'block';
  id: string;
  blue_score: number;
}

export interface WsTxMsg {
  type: 'tx';
  id: string;
  from: string;
  to: string;
  amount: number;
}

export interface WsTipMsg {
  type: 'tip';
  id: string;
  blue_score: number;
}

export interface WsPeerMsg {
  type: 'peer';
  addr: string;
  connected: boolean;
}

export interface WsStateMsg {
  type: 'state';
  snapshot: string; // JSON string
}

export interface WsPingMsg { type: 'ping'; }
export interface WsPongMsg { type: 'pong'; }

export type WsMsg = WsBlockMsg | WsTxMsg | WsTipMsg | WsPeerMsg | WsStateMsg | WsPingMsg | WsPongMsg;

export interface SupplyData {
  minted: number;
  total: number;
  circulating: number;
  burned: number;
  max: number;
  subsidy: number;
  era: number;
  percent: number;
}