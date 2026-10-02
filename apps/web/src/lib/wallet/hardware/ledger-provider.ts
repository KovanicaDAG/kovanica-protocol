import { bytesToHex } from "@noble/hashes/utils.js";
import {
  HardwareDeviceType,
  HardwareDeviceInfo,
  HardwarePublicKeyResult,
  HardwareSignResult,
  HardwareConnectOptions,
  HardwareSignOptions,
  HardwareWalletError,
} from "./types";
import {
  AbstractHardwareProvider,
  parseAccountOrPath,
  validateSighash,
} from "./abstract-provider";

/**
 * Serializes a BIP-44 path into Ledger binary format:
 * [segment_count (1 byte), 4-byte big-endian uint32 for each segment...]
 */
export function serializeBip44Path(path: string): Uint8Array {
  const normalized = path.replace(/^m\//, "").replace(/\/$/, "");
  const parts = normalized.split("/");
  const buffer = new Uint8Array(1 + parts.length * 4);
  buffer[0] = parts.length;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let val = parseInt(part.replace("'", ""), 10);
    if (part.endsWith("'")) {
      val = (val | 0x80000000) >>> 0;
    }
    const offset = 1 + i * 4;
    buffer[offset] = (val >>> 24) & 0xff;
    buffer[offset + 1] = (val >>> 16) & 0xff;
    buffer[offset + 2] = (val >>> 8) & 0xff;
    buffer[offset + 3] = val & 0xff;
  }
  return buffer;
}

export function isWebUsbSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof (navigator as unknown as { usb?: unknown }).usb !== "undefined"
  );
}

export function mapLedgerError(error: unknown): HardwareWalletError {
  if (error instanceof HardwareWalletError) return error;

  const err = error as {
    statusCode?: number;
    statusText?: string;
    message?: string;
    name?: string;
  };
  const code = err?.statusCode;
  const msg = err?.message || String(error || "");

  if (
    code === 0x6985 ||
    msg.includes("0x6985") ||
    msg.includes("User cancelled") ||
    msg.includes("TransportOpenUserCancelled") ||
    msg.includes("Action cancelled by user") ||
    msg.includes("Condition not satisfied")
  ) {
    return new HardwareWalletError(
      "Transaction was rejected on the Ledger device.",
      "USER_REJECTED",
      "ledger",
    );
  }

  if (
    code === 0x6e00 ||
    code === 0x6d00 ||
    code === 0x6e01 ||
    msg.includes("0x6e00") ||
    msg.includes("0x6d00") ||
    msg.includes("CLA_NOT_SUPPORTED") ||
    msg.includes("INS_NOT_SUPPORTED")
  ) {
    return new HardwareWalletError(
      "Kovanica App is not open on your Ledger device. Please unlock your device, open the Kovanica App, and try again.",
      "APP_NOT_OPEN",
      "ledger",
    );
  }

  if (
    code === 0x5515 ||
    msg.includes("0x5515") ||
    msg.includes("Device is locked") ||
    msg.includes("Locked device")
  ) {
    return new HardwareWalletError(
      "Ledger device is locked with PIN. Please unlock your Ledger device.",
      "DEVICE_LOCKED",
      "ledger",
    );
  }

  if (code === 0x6a80 || msg.includes("0x6a80")) {
    return new HardwareWalletError(
      "Invalid transaction parameters or derivation path for Ledger.",
      "INVALID_PATH",
      "ledger",
    );
  }

  if (
    msg.includes("No device selected") ||
    msg.includes("device disconnected") ||
    msg.includes("disconnected") ||
    msg.includes("Transfer failed") ||
    msg.includes("unable to claim interface")
  ) {
    return new HardwareWalletError(
      "Ledger device disconnected or not found. Please connect your Ledger via USB.",
      "DEVICE_NOT_CONNECTED",
      "ledger",
    );
  }

  return new HardwareWalletError(
    msg || "Unknown Ledger communication error",
    "COMMUNICATION_ERROR",
    "ledger",
  );
}

// Minimal transport interface for Ledger WebUSB transport
interface LedgerTransportLike {
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Uint8Array | unknown,
    statusList?: number[]
  ): Promise<Uint8Array | { buffer: ArrayBuffer; byteOffset: number }>;
  close(): Promise<void>;
  deviceModel?: { id: string; productName: string };
}

/**
 * LedgerHardwareProvider communicates with Ledger hardware wallets via WebUSB APDUs.
 * SSR-safe with dynamic import and WebUSB feature detection.
 */
export class LedgerHardwareProvider extends AbstractHardwareProvider {
  readonly deviceType: HardwareDeviceType = "ledger";

  private transport: LedgerTransportLike | null = null;

  async connect(options?: HardwareConnectOptions): Promise<HardwareDeviceInfo> {
    if (!isWebUsbSupported()) {
      throw new HardwareWalletError(
        "WebUSB is not supported in this browser. Please use Google Chrome, Brave, or Microsoft Edge on HTTPS / localhost.",
        "UNSUPPORTED_BROWSER",
        "ledger",
      );
    }

    try {
      // Dynamic import to prevent SSR/Node bundling breakage
      const mod = await import("@ledgerhq/hw-transport-webusb");
      const TransportWebUSB = (mod.default || mod) as {
        create: () => Promise<LedgerTransportLike>;
      };

      this.transport = await TransportWebUSB.create();
      this.connected = true;

      const modelName = this.transport.deviceModel?.productName || "Ledger Device";
      this.deviceInfo = {
        type: "ledger",
        model: modelName,
        label: `Ledger (${modelName})`,
        connected: true,
      };

      return this.deviceInfo;
    } catch (err) {
      this.connected = false;
      this.transport = null;
      this.deviceInfo = null;
      throw mapLedgerError(err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        /* ignore close errors */
      }
      this.transport = null;
    }
    this.connected = false;
    this.deviceInfo = null;
  }

  async getPublicKey(accountIndexOrPath?: number | string): Promise<HardwarePublicKeyResult> {
    this.ensureConnected();
    if (!this.transport) {
      throw new HardwareWalletError("Ledger transport not initialized", "DEVICE_NOT_CONNECTED", "ledger");
    }

    const { path } = parseAccountOrPath(accountIndexOrPath);
    const pathBytes = serializeBip44Path(path);

    try {
      // CLA: 0xE0, INS: 0x02 (GET_PUBLIC_KEY), P1: 0x00, P2: 0x00
      const res = await this.transport.send(0xe0, 0x02, 0x00, 0x00, pathBytes);
      const raw = res instanceof Uint8Array ? res : new Uint8Array(res.buffer, res.byteOffset, 32);
      const pubKeyBytes = raw.slice(0, 32);
      const publicKey = bytesToHex(pubKeyBytes).toLowerCase();

      return {
        publicKey,
        address: publicKey,
        path,
      };
    } catch (err) {
      throw mapLedgerError(err);
    }
  }

  async signTransaction(
    accountIndexOrPath: number | string,
    sighashHex: string,
    options?: HardwareSignOptions
  ): Promise<HardwareSignResult> {
    this.ensureConnected();
    if (!this.transport) {
      throw new HardwareWalletError("Ledger transport not initialized", "DEVICE_NOT_CONNECTED", "ledger");
    }

    const { path } = parseAccountOrPath(accountIndexOrPath);
    const pathBytes = serializeBip44Path(path);
    const sighashBytes = validateSighash(sighashHex, "ledger");

    // Payload = [pathBytes, sighashBytes]
    const payload = new Uint8Array(pathBytes.length + sighashBytes.length);
    payload.set(pathBytes, 0);
    payload.set(sighashBytes, pathBytes.length);

    options?.onStatusChange?.("Please review and confirm transaction on your Ledger screen...");

    try {
      // CLA: 0xE0, INS: 0x04 (SIGN_TRANSACTION), P1: 0x00, P2: 0x00
      const res = await this.transport.send(0xe0, 0x04, 0x00, 0x00, payload);
      const raw = res instanceof Uint8Array ? res : new Uint8Array(res.buffer, res.byteOffset, 64);
      const sigBytes = raw.slice(0, 64);
      const signature = bytesToHex(sigBytes).toLowerCase();
      const normalizedSighash = bytesToHex(sighashBytes).toLowerCase();

      return {
        signature,
        sighash: normalizedSighash,
        path,
      };
    } catch (err) {
      throw mapLedgerError(err);
    }
  }
}
