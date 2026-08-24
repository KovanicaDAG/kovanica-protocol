/**
 * Hardware Wallet Provider Interface & Common Types for Kovanica
 */

export type HardwareDeviceType = "ledger" | "trezor" | "mock";

export interface HardwareDeviceInfo {
  type: HardwareDeviceType;
  model?: string;
  deviceId?: string;
  label?: string;
  version?: string;
  connected: boolean;
}

export interface HardwarePublicKeyResult {
  publicKey: string; // 32 bytes -> 64 lowercase hex characters
  address: string;   // 64 lowercase hex characters (matches Ed25519 pubkey)
  path: string;      // BIP-44 path, e.g. "m/44'/999'/0'/0/0"
}

export interface HardwareSignResult {
  signature: string; // 64 bytes -> 128 lowercase hex characters
  sighash: string;   // 32 bytes -> 64 lowercase hex characters
  path: string;
}

export interface HardwareConnectOptions {
  accountIndex?: number;
  path?: string;
}

export interface HardwareSignOptions {
  timeoutMs?: number;
  onStatusChange?: (status: string) => void;
}

export type HardwareErrorCode =
  | "DEVICE_NOT_CONNECTED"
  | "DEVICE_LOCKED"
  | "USER_REJECTED"
  | "APP_NOT_OPEN"
  | "COMMUNICATION_ERROR"
  | "TIMEOUT"
  | "UNSUPPORTED_BROWSER"
  | "INVALID_PATH"
  | "UNKNOWN";

export class HardwareWalletError extends Error {
  readonly code: HardwareErrorCode;
  readonly deviceType: HardwareDeviceType;

  constructor(message: string, code: HardwareErrorCode, deviceType: HardwareDeviceType) {
    super(message);
    this.name = "HardwareWalletError";
    this.code = code;
    this.deviceType = deviceType;
  }
}

export interface IHardwareProvider {
  readonly deviceType: HardwareDeviceType;
  connect(options?: HardwareConnectOptions): Promise<HardwareDeviceInfo>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDeviceInfo(): HardwareDeviceInfo | null;
  getPublicKey(accountIndexOrPath?: number | string): Promise<HardwarePublicKeyResult>;
  signTransaction(
    accountIndexOrPath: number | string,
    sighashHex: string,
    options?: HardwareSignOptions
  ): Promise<HardwareSignResult>;
}
