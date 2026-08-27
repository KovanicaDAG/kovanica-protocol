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

import type { HardwareDeviceType } from "@/lib/wallet/hardware/types";

export type SoftwareWalletRec = {
  type?: "mnemonic";
  mnemonic: string;
  address: string;
  index: number;
  shown: boolean;
  kind?: "local" | "hardware" | "watch";
};

export type HardwareWalletRec = {
  type: "hardware";
  deviceType: HardwareDeviceType;
  address: string;
  index: number;
  path: string;
  mnemonic?: undefined;
  shown?: boolean;
  deviceInfo?: {
    model?: string;
    label?: string;
    version?: string;
  };
};

export type WalletRec = SoftwareWalletRec | HardwareWalletRec;

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
