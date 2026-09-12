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
import type { EncryptedBundle } from "@/lib/wallet/vault";

export type SoftwareWalletRec = {
  type?: "mnemonic";
  /** Plain BIP39 mnemonic. Keep in memory only; never persist without encryption. */
  mnemonic?: string;
  /** Encrypted mnemonic, safe to persist. When present and `mnemonic` is absent the wallet is locked. */
  encryptedMnemonic?: EncryptedBundle;
  address: string;
  index: number;
  shown: boolean;
  kind?: "local" | "watch";
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
export const SUBSIDY = 10 * ATOM;
export const NETWORK = "kovanica-testnet";
export const K = 3;
