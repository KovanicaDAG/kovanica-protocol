import { hexToBytes } from "@noble/hashes/utils.js";
import {
  HardwareDeviceType,
  HardwareDeviceInfo,
  HardwarePublicKeyResult,
  HardwareSignResult,
  HardwareConnectOptions,
  HardwareSignOptions,
  HardwareWalletError,
  IHardwareProvider,
} from "./types";

export const KOVANICA_COIN_TYPE = 3007;

/**
 * Formats a standard Kovanica BIP-44 derivation path: m/44'/3007'/${account}'/${change}/${index}
 */
export function formatDerivationPath(account = 0, change = 0, index = 0): string {
  const safeAccount = Math.max(0, Math.floor(Number(account) || 0));
  const safeChange = Math.max(0, Math.floor(Number(change) || 0));
  const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
  return `m/44'/${KOVANICA_COIN_TYPE}'/${safeAccount}'/${safeChange}/${safeIndex}`;
}

/**
 * Parses either an account index (e.g. 0, 1, 2) or a full path string (e.g. "m/44'/3007'/1'/0/0").
 * Returns normalized path and account index.
 */
export function parseAccountOrPath(accountIndexOrPath?: number | string): {
  path: string;
  accountIndex: number;
} {
  if (accountIndexOrPath === undefined || accountIndexOrPath === null) {
    return { path: formatDerivationPath(0, 0, 0), accountIndex: 0 };
  }

  if (typeof accountIndexOrPath === "number") {
    return {
      path: formatDerivationPath(accountIndexOrPath, 0, 0),
      accountIndex: Math.max(0, Math.floor(accountIndexOrPath)),
    };
  }

  const rawPath = accountIndexOrPath.trim();
  const normalized = rawPath.startsWith("m/") ? rawPath : `m/${rawPath}`;
  const match = normalized.match(/^m\/44'\/(\d+)'\/(\d+)'\/(\d+)\/(\d+)$/);

  if (match) {
    const account = parseInt(match[2], 10);
    return { path: normalized, accountIndex: account };
  }

  // Fallback for paths with different formats
  const parts = normalized.split("/");
  if (parts.length >= 4) {
    const accountPart = parts[3].replace(/'/g, "");
    const parsedAcc = parseInt(accountPart, 10);
    if (!Number.isNaN(parsedAcc)) {
      return { path: normalized, accountIndex: parsedAcc };
    }
  }

  return { path: normalized, accountIndex: 0 };
}

/**
 * Validates that a sighash hex string is 32 bytes (64 hex characters) and converts to Uint8Array.
 */
export function validateSighash(sighashHex: string, deviceType: HardwareDeviceType = "mock"): Uint8Array {
  const hex = (sighashHex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new HardwareWalletError(
      `Invalid sighash format: expected 64 hex characters (32 bytes), received "${sighashHex}"`,
      "UNKNOWN",
      deviceType,
    );
  }
  return hexToBytes(hex);
}

/**
 * Abstract base class providing common status tracking and path utilities for hardware providers.
 */
export abstract class AbstractHardwareProvider implements IHardwareProvider {
  abstract readonly deviceType: HardwareDeviceType;

  protected connected: boolean = false;
  protected deviceInfo: HardwareDeviceInfo | null = null;

  isConnected(): boolean {
    return this.connected;
  }

  getDeviceInfo(): HardwareDeviceInfo | null {
    return this.deviceInfo;
  }

  abstract connect(options?: HardwareConnectOptions): Promise<HardwareDeviceInfo>;
  abstract disconnect(): Promise<void>;
  abstract getPublicKey(accountIndexOrPath?: number | string): Promise<HardwarePublicKeyResult>;
  abstract signTransaction(
    accountIndexOrPath: number | string,
    sighashHex: string,
    options?: HardwareSignOptions
  ): Promise<HardwareSignResult>;

  protected ensureConnected(): void {
    if (!this.connected) {
      throw new HardwareWalletError(
        `${this.deviceType.toUpperCase()} device is not connected. Please connect your device first.`,
        "DEVICE_NOT_CONNECTED",
        this.deviceType,
      );
    }
  }
}
