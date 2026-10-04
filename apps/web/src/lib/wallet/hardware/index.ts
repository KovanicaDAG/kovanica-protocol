import {
  HardwareDeviceType,
  IHardwareProvider,
} from "./types";
import { MockHardwareProvider } from "./mock-provider";
import { LedgerHardwareProvider } from "./ledger-provider";
import { TrezorHardwareProvider } from "./trezor-provider";

export * from "./types";
export * from "./abstract-provider";
export * from "./mock-provider";
export * from "./ledger-provider";
export * from "./trezor-provider";

const providerInstances: Partial<Record<HardwareDeviceType, IHardwareProvider>> = {};
let activeProvider: IHardwareProvider | null = null;

/**
 * Gets or creates a singleton hardware provider instance for the specified device type.
 */
export function getHardwareProvider(type: HardwareDeviceType): IHardwareProvider {
  if (!providerInstances[type]) {
    switch (type) {
      case "mock":
        providerInstances[type] = new MockHardwareProvider();
        break;
      case "ledger":
        providerInstances[type] = new LedgerHardwareProvider();
        break;
      case "trezor":
        providerInstances[type] = new TrezorHardwareProvider();
        break;
      default:
        throw new Error(`Unsupported hardware wallet type: ${String(type)}`);
    }
  }
  return providerInstances[type]!;
}

/**
 * Returns the currently active connected hardware wallet provider, or null.
 */
export function getActiveHardwareProvider(): IHardwareProvider | null {
  return activeProvider;
}

/**
 * Sets the active hardware wallet provider.
 */
export function setActiveHardwareProvider(provider: IHardwareProvider | null): void {
  activeProvider = provider;
}

/**
 * Disconnects and unsets the active hardware wallet provider.
 */
export async function disconnectActiveHardwareProvider(): Promise<void> {
  if (activeProvider) {
    try {
      await activeProvider.disconnect();
    } catch {
      /* ignore disconnect error */
    }
    activeProvider = null;
  }
}
