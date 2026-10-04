import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  HardwareDeviceType,
  HardwareDeviceInfo,
  HardwarePublicKeyResult,
  HardwareSignResult,
  HardwareConnectOptions,
  HardwareSignOptions,
  HardwareErrorCode,
  HardwareWalletError,
} from "./types";
import {
  AbstractHardwareProvider,
  parseAccountOrPath,
  validateSighash,
} from "./abstract-provider";

// Ensure ed25519 has sha512 configured
ed.hashes.sha512 = sha512;

const DEFAULT_MOCK_SEED_PREFIX = "kovanica-mock-hw-v1-entropy";

/**
 * MockHardwareProvider implements IHardwareProvider for CI pipelines, automated tests,
 * and simulator environments without physical USB hardware devices.
 * Produces genuine Ed25519 signatures and deterministic public keys.
 */
export class MockHardwareProvider extends AbstractHardwareProvider {
  readonly deviceType: HardwareDeviceType = "mock";

  private simulatedDelayMs: number = 0;
  private simulatedError: HardwareErrorCode | null = null;
  private masterSeedPrefix: string = DEFAULT_MOCK_SEED_PREFIX;
  private model: string = "Mock Hardware Wallet Simulator";
  private version: string = "1.0.0-mock";
  private deviceId: string = "mock-device-001";

  constructor(options?: {
    simulatedDelayMs?: number;
    simulatedError?: HardwareErrorCode | null;
    masterSeedPrefix?: string;
  }) {
    super();
    if (options?.simulatedDelayMs !== undefined) {
      this.simulatedDelayMs = options.simulatedDelayMs;
    }
    if (options?.simulatedError !== undefined) {
      this.simulatedError = options.simulatedError;
    }
    if (options?.masterSeedPrefix !== undefined) {
      this.masterSeedPrefix = options.masterSeedPrefix;
    }
  }

  /**
   * Set simulated delay in milliseconds for testing async UI states.
   */
  setSimulatedDelay(ms: number): this {
    this.simulatedDelayMs = Math.max(0, ms);
    return this;
  }

  /**
   * Set simulated error code to test failure and rejection flows.
   */
  setSimulatedError(error: HardwareErrorCode | null): this {
    this.simulatedError = error;
    return this;
  }

  /**
   * Customize master seed prefix for testing different key sets.
   */
  setMasterSeedPrefix(prefix: string): this {
    this.masterSeedPrefix = prefix;
    return this;
  }

  /**
   * Reset simulation options to defaults.
   */
  resetSimulation(): void {
    this.simulatedDelayMs = 0;
    this.simulatedError = null;
    this.masterSeedPrefix = DEFAULT_MOCK_SEED_PREFIX;
  }

  /**
   * Derives a deterministic 32-byte Ed25519 private seed for a given account/path.
   */
  private getSeedForAccount(accountIndex: number, path: string): Uint8Array {
    return sha256(utf8ToBytes(`${this.masterSeedPrefix}|${accountIndex}|${path}`));
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private checkSimulatedError(): void {
    if (this.simulatedError) {
      const code = this.simulatedError;
      switch (code) {
        case "USER_REJECTED":
          throw new HardwareWalletError("User rejected the action on Mock device.", "USER_REJECTED", "mock");
        case "DEVICE_LOCKED":
          throw new HardwareWalletError("Mock device is locked with PIN.", "DEVICE_LOCKED", "mock");
        case "APP_NOT_OPEN":
          throw new HardwareWalletError("Kovanica App is not open on Mock device.", "APP_NOT_OPEN", "mock");
        case "DEVICE_NOT_CONNECTED":
          throw new HardwareWalletError("Mock device is disconnected.", "DEVICE_NOT_CONNECTED", "mock");
        case "TIMEOUT":
          throw new HardwareWalletError("Mock device communication timed out.", "TIMEOUT", "mock");
        default:
          throw new HardwareWalletError(`Mock error triggered: ${code}`, code, "mock");
      }
    }
  }

  async connect(options?: HardwareConnectOptions): Promise<HardwareDeviceInfo> {
    if (this.simulatedDelayMs > 0) {
      await this.sleep(this.simulatedDelayMs);
    }

    this.checkSimulatedError();

    this.connected = true;
    this.deviceInfo = {
      type: "mock",
      model: this.model,
      deviceId: this.deviceId,
      label: "Kovanica Mock Device",
      version: this.version,
      connected: true,
    };

    return this.deviceInfo;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.deviceInfo = null;
  }

  async getPublicKey(accountIndexOrPath?: number | string): Promise<HardwarePublicKeyResult> {
    this.ensureConnected();

    if (this.simulatedDelayMs > 0) {
      await this.sleep(this.simulatedDelayMs);
    }

    this.checkSimulatedError();

    const { path, accountIndex } = parseAccountOrPath(accountIndexOrPath);
    const seed = this.getSeedForAccount(accountIndex, path);
    const pubKeyBytes = ed.getPublicKey(seed);
    const publicKey = bytesToHex(pubKeyBytes).toLowerCase();

    return {
      publicKey,
      address: publicKey, // In Kovanica, raw address is 64-hex lowercase Ed25519 pubkey
      path,
    };
  }

  async signTransaction(
    accountIndexOrPath: number | string,
    sighashHex: string,
    options?: HardwareSignOptions
  ): Promise<HardwareSignResult> {
    this.ensureConnected();

    options?.onStatusChange?.("Reviewing transaction on Mock device...");

    if (this.simulatedDelayMs > 0) {
      await this.sleep(this.simulatedDelayMs);
    }

    this.checkSimulatedError();

    const { path, accountIndex } = parseAccountOrPath(accountIndexOrPath);
    const sighashBytes = validateSighash(sighashHex, "mock");
    const seed = this.getSeedForAccount(accountIndex, path);

    options?.onStatusChange?.("Confirming signature...");

    const sigBytes = ed.sign(sighashBytes, seed);
    const signature = bytesToHex(sigBytes).toLowerCase();
    const normalizedSighash = bytesToHex(sighashBytes).toLowerCase();

    return {
      signature,
      sighash: normalizedSighash,
      path,
    };
  }
}
