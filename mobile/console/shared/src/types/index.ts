export interface Head {
  genesis: string;
  selected_tip: string;
  block_count: number;
  chain_height: number;
  max_supply: string;
  minted: string;
  min_fee: number;
  finality_depth: number;
  authorities: Authority[];
  era: number;
  era_len: number;
  subsidy: string;
}

export interface Authority {
  pubkey: string;
  slot: number;
}

export interface Block {
  id: string;
  parents: string[];
  work: string;
  timestamp_ms: number;
  height: number;
  tx_count: number;
}

export interface Utxo {
  outpoint: string;
  tx_id: string;
  index: number;
  value: string;
  address: string;
  asset_id: string | null;
}

export interface Transaction {
  id: string;
  inputs: TxInput[];
  outputs: TxOutput[];
  fee: string;
  block_id: string;
  timestamp_ms: number;
}

export interface TxInput {
  outpoint: string;
  tx_id: string;
  index: number;
  signature: string;
}

export interface TxOutput {
  value: string;
  address: string;
  asset_id: string | null;
}

export interface PrepareRequest {
  from: string;
  to: string;
  amount: string;
}

export interface PrepareResponse {
  sighash: string;
  fee: string;
  tx: string;
}

export interface SubmitRequest {
  from: string;
  to: string;
  amount: string;
  signature: string;
}

export interface SubmitResponse {
  tx: string;
  block_id: string;
}

export interface BalanceResponse {
  address: string;
  balance: string;
  utxos: Utxo[];
}

export interface HistoryEntry {
  block_id: string;
  tx_id: string;
  direction: 'Received' | 'Sent';
  amount: string;
  asset_id: string | null;
}

export interface MultisigAddress {
  address: string;
  redeem_script: string;
}

export interface HtlcInfo {
  script: string;
  address: string;
  tx_id: string;
  outpoint_tx: string;
  outpoint_index: number;
}

export interface AssetInfo {
  asset_id: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  issuer: string;
}

export interface NftInfo {
  asset_id: string;
  name: string;
  collection_id: string;
  owner: string;
  metadata: string;
}

export interface ApiResponse<T> {
  data: T;
  error: string | null;
}