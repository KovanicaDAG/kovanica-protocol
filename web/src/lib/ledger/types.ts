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
  kind?: "hardware";
  deviceInfo?: {
    model?: string;
    label?: string;
    version?: string;
  };
};

export type WatchWalletRec = {
  kind: "watch";
  address: string;
  index: number;
  shown: boolean;
  mnemonic?: undefined;
  type?: undefined;
};

export type WalletRec = SoftwareWalletRec | HardwareWalletRec | WatchWalletRec;

export type HistoryRow = {
  id: string;
  from: string;
  to: string;
  amount: number;
  ts: number;
  kind: "faucet" | "send" | "coinbase";
};

export const ATOM = 100_000_000;
export const DECIMALS = 8;
export const SUBSIDY = 200 * ATOM;
export const NETWORK = "kovanica-testnet";
export const K = 3;
