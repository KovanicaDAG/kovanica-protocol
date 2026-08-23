export type Colour = "genesis" | "chain" | "blue" | "red";

export type Tx = {
  id: string;
  coinbase: boolean;
  from?: string;
  to?: string;
  amount: number;
};

export type Block = {
  id: string;
  parents: string[];
  selectedParent: string | null;
  work: number;
  timestamp: number;
  nonce: number;
  blueScore: number;
  colour: Colour;
  height: number;
  txs: Tx[];
};

export type WalletRec = {
  mnemonic: string;
  address: string;
  index: number;
  shown: boolean;
};

export type HistoryRow = {
  id: string;
  from: string;
  to: string;
  amount: number;
  ts: number;
  kind: "faucet" | "send" | "coinbase" | "tap";
};

export const ATOM = 100_000_000;
export const DECIMALS = 8;
export const SUBSIDY = 50 * ATOM;
export const NETWORK = "kovanica-testnet-1";
export const K = 3;
