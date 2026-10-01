import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Cpu, HardDrive, ShieldCheck, X, Loader2, AlertTriangle, CheckCircle2, Usb } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  HardwareDeviceType,
  HardwareWalletError,
  formatDerivationPath,
  getHardwareProvider,
  setActiveHardwareProvider,
} from "@/lib/wallet/hardware";
import type { HardwareWalletRec } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";

interface ConnectHardwareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (wallet: HardwareWalletRec) => void;
}

interface DeviceOption {
  type: HardwareDeviceType;
  name: string;
  subtitle: string;
  description: string;
  icon: typeof HardDrive;
  recommendedFor?: string;
}

const DEVICES: DeviceOption[] = [
  {
    type: "ledger",
    name: "Ledger",
    subtitle: "Nano S, Nano X, Nano S Plus, Stax, Flex",
    description: "Connect via WebUSB. Requires Chrome, Edge, or Brave on HTTPS.",
    icon: HardDrive,
  },
  {
    type: "trezor",
    name: "Trezor",
    subtitle: "Model One, Model T, Safe 3, Safe 5",
    description: "Connect via Trezor Connect protocol with popup confirmation.",
    icon: ShieldCheck,
  },
  {
    type: "mock",
    name: "Mock Simulator",
    subtitle: "Automated Testing & Headless CI Device",
    description: "Deterministic Ed25519 keys for testing without physical USB hardware.",
    icon: Cpu,
    recommendedFor: "Dev & CI",
  },
];

const ACCOUNTS = [0, 1, 2] as const;

export function ConnectHardwareModal({
  open,
  onOpenChange,
  onConnected,
}: ConnectHardwareModalProps) {
  const [selectedDevice, setSelectedDevice] = useState<HardwareDeviceType>("ledger");
  const [selectedAccount, setSelectedAccount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConnect() {
    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(`Requesting connection to ${selectedDevice.toUpperCase()}...`);

    try {
      const provider = getHardwareProvider(selectedDevice);
      const path = formatDerivationPath(selectedAccount, 0, 0);

      setStatusMessage(`Please unlock device and confirm connection on your ${selectedDevice}...`);
      const deviceInfo = await provider.connect({ accountIndex: selectedAccount, path });

      setStatusMessage(`Exporting public key for path ${path}...`);
      const pubResult = await provider.getPublicKey(selectedAccount);

      setActiveHardwareProvider(provider);

      const walletRec: HardwareWalletRec = {
        type: "hardware",
        deviceType: selectedDevice,
        address: pubResult.address,
        index: selectedAccount,
        path: pubResult.path,
        deviceInfo: {
          model: deviceInfo.model,
          label: deviceInfo.label,
          version: deviceInfo.version,
        },
      };

      toast.success(`${DEVICES.find((d) => d.type === selectedDevice)?.name} connected!`);
      onConnected(walletRec);
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof HardwareWalletError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to connect hardware device";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setStatusMessage(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-xl border border-border bg-surface p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Usb className="size-5 text-accent" />
              <Dialog.Title className="font-display text-xl text-fg">
                Connect Hardware Wallet
              </Dialog.Title>
            </div>
            <Dialog.Close asChild disabled={busy}>
              <Button variant="ghost" size="icon" className="size-8 text-muted hover:text-fg">
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="mt-2 text-xs leading-relaxed text-muted">
            Select your hardware device and account index. Your private keys never leave your physical device.
          </Dialog.Description>

          <div className="mt-5 space-y-3">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Select Device</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {DEVICES.map((dev) => {
                const isSelected = selectedDevice === dev.type;
                const Icon = dev.icon;
                return (
                  <button
                    key={dev.type}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelectedDevice(dev.type);
                      setErrorMessage(null);
                    }}
                    className={cn(
                      "flex flex-col items-start justify-between rounded-lg border p-3 text-left transition-all",
                      isSelected
                        ? "border-accent bg-surface-2 shadow-sm ring-1 ring-accent"
                        : "border-border bg-bg/50 hover:border-subtle hover:bg-surface-2/60",
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <Icon className={cn("size-5", isSelected ? "text-accent" : "text-muted")} />
                      {dev.recommendedFor && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                          {dev.recommendedFor}
                        </span>
                      )}
                    </div>
                    <div className="mt-3">
                      <p className="font-sans text-sm font-semibold text-fg">{dev.name}</p>
                      <p className="mt-0.5 text-[11px] leading-tight text-muted line-clamp-2">
                        {dev.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Account Index</p>
              <span className="font-mono text-[11px] text-muted">
                {formatDerivationPath(selectedAccount, 0, 0)}
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              {ACCOUNTS.map((acc) => (
                <button
                  key={acc}
                  type="button"
                  disabled={busy}
                  onClick={() => setSelectedAccount(acc)}
                  className={cn(
                    "flex-1 rounded-md border py-2 font-mono text-xs transition-colors",
                    selectedAccount === acc
                      ? "border-accent bg-surface-2 font-medium text-fg"
                      : "border-border bg-bg text-muted hover:text-fg",
                  )}
                >
                  Account {acc}
                </button>
              ))}
            </div>
          </div>

          {statusMessage && (
            <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-fg">
              <Loader2 className="size-4 animate-spin text-accent" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">
                <p className="font-medium">Connection Failed</p>
                <p className="mt-0.5 text-[11px] opacity-90">{errorMessage}</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void handleConnect()}
              className="min-w-28"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  Connecting…
                </span>
              ) : (
                "Connect Device"
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
