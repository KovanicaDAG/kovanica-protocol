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

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function mapTrezorError(error: unknown): HardwareWalletError {
  if (error instanceof HardwareWalletError) return error;

  const msg =
    typeof error === "string"
      ? error
      : (error as { message?: string; error?: string })?.error ||
        (error as Error)?.message ||
        String(error || "");

  if (
    msg.includes("Cancelled") ||
    msg.includes("cancelled") ||
    msg.includes("Action cancelled by user") ||
    msg.includes("Permission denied") ||
    msg.includes("Iframe closed")
  ) {
    return new HardwareWalletError(
      "Action was cancelled or rejected by user on Trezor.",
      "USER_REJECTED",
      "trezor",
    );
  }

  if (msg.includes("PIN") || msg.includes("locked") || msg.includes("Passphrase")) {
    return new HardwareWalletError(
      "Trezor device is locked. Please enter your PIN / Passphrase on device.",
      "DEVICE_LOCKED",
      "trezor",
    );
  }

  if (
    msg.includes("Device disconnected") ||
    msg.includes("disconnected") ||
    msg.includes("device not found") ||
    msg.includes("No device selected")
  ) {
    return new HardwareWalletError(
      "Trezor device disconnected. Please connect your Trezor via USB.",
      "DEVICE_NOT_CONNECTED",
      "trezor",
    );
  }

  if (msg.includes("Popup closed") || msg.includes("window closed")) {
    return new HardwareWalletError(
      "Trezor popup was closed before operation completed.",
      "USER_REJECTED",
      "trezor",
    );
  }

  return new HardwareWalletError(
    msg || "Unknown Trezor communication error",
    "COMMUNICATION_ERROR",
    "trezor",
  );
}

/**
 * TrezorHardwareProvider communicates with Trezor devices via @trezor/connect-web.
 * Fully SSR-safe with dynamic client-side loading and manifest initialization.
 */
export class TrezorHardwareProvider extends AbstractHardwareProvider {
  readonly deviceType: HardwareDeviceType = "trezor";

  private initialized: boolean = false;

  private async ensureTrezorInitialized(): Promise<any> {
    if (!isBrowser()) {
      throw new HardwareWalletError(
        "Trezor Connect requires a browser environment.",
        "UNSUPPORTED_BROWSER",
        "trezor",
      );
    }

    const TrezorConnect = (await import("@trezor/connect-web")).default;

    if (!this.initialized) {
      try {
        await TrezorConnect.init({
          lazyLoad: true,
          manifest: {
            appName: "Kovanica Web Wallet",
            email: "dev@kovanica.org",
            appUrl: "https://kovanica.online",
          },
        });
        this.initialized = true;
      } catch (err) {
        // If already initialized, continue
        const msg = String(err || "");
        if (msg.includes("already initialized") || msg.includes("Init called")) {
          this.initialized = true;
        } else {
          throw mapTrezorError(err);
        }
      }
    }

    return TrezorConnect;
  }

  async connect(options?: HardwareConnectOptions): Promise<HardwareDeviceInfo> {
    try {
      const TrezorConnect = await this.ensureTrezorInitialized();

      // Verify connection by querying device features
      const features = await TrezorConnect.getFeatures();
      let model = "Trezor Device";
      let label = "Trezor";

      if (features.success) {
        model = features.payload.model || features.payload.label || "Trezor";
        label = `Trezor (${model})`;
      }

      this.connected = true;
      this.deviceInfo = {
        type: "trezor",
        model,
        label,
        connected: true,
      };

      return this.deviceInfo;
    } catch (err) {
      this.connected = false;
      this.deviceInfo = null;
      throw mapTrezorError(err);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.initialized && isBrowser()) {
        const TrezorConnect = (await import("@trezor/connect-web")).default;
        await TrezorConnect.dispose();
        this.initialized = false;
      }
    } catch {
      /* ignore disposal error */
    }
    this.connected = false;
    this.deviceInfo = null;
  }

  async getPublicKey(accountIndexOrPath?: number | string): Promise<HardwarePublicKeyResult> {
    this.ensureConnected();
    const TrezorConnect = await this.ensureTrezorInitialized();
    const { path } = parseAccountOrPath(accountIndexOrPath);

    try {
      const result = await TrezorConnect.getPublicKey({
        path,
        coin: "ed25519",
      });

      if (!result.success) {
        throw mapTrezorError(result.payload.error);
      }

      // Trezor returns publicKey in hex or xpub
      let pubHex = result.payload.publicKey;
      if (!pubHex || pubHex.length !== 64) {
        // If xpub or encoded key returned, extract or normalize 32-byte key
        if (result.payload.xpubHex && result.payload.xpubHex.length >= 64) {
          pubHex = result.payload.xpubHex.slice(-64);
        } else if (result.payload.publicKey && result.payload.publicKey.length > 64) {
          pubHex = result.payload.publicKey.slice(-64);
        }
      }

      const normalizedPub = (pubHex || "").toLowerCase();

      return {
        publicKey: normalizedPub,
        address: normalizedPub,
        path,
      };
    } catch (err) {
      throw mapTrezorError(err);
    }
  }

  async signTransaction(
    accountIndexOrPath: number | string,
    sighashHex: string,
    options?: HardwareSignOptions
  ): Promise<HardwareSignResult> {
    this.ensureConnected();
    const TrezorConnect = await this.ensureTrezorInitialized();
    const { path } = parseAccountOrPath(accountIndexOrPath);
    const sighashBytes = validateSighash(sighashHex, "trezor");
    const normalizedSighash = bytesToHex(sighashBytes).toLowerCase();

    options?.onStatusChange?.("Please review and confirm transaction on Trezor screen...");

    try {
      // Use signMessage / custom sign with sighash bytes
      const result = await TrezorConnect.signMessage({
        path,
        coin: "ed25519",
        message: normalizedSighash,
        hex: true,
      });

      if (!result.success) {
        throw mapTrezorError(result.payload.error);
      }

      let signatureHex = result.payload.signature;
      // Ensure 128-hex character format
      if (signatureHex && !/^[0-9a-f]{128}$/i.test(signatureHex)) {
        // If base64 returned, convert to hex
        try {
          const rawSig = Uint8Array.from(atob(signatureHex), (c) => c.charCodeAt(0));
          if (rawSig.length === 64) {
            signatureHex = bytesToHex(rawSig);
          }
        } catch {
          /* keep as-is */
        }
      }

      return {
        signature: (signatureHex || "").toLowerCase(),
        sighash: normalizedSighash,
        path,
      };
    } catch (err) {
      throw mapTrezorError(err);
    }
  }
}
