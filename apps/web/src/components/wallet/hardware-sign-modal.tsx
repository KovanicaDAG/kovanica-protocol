import { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HardwareDeviceType,
  HardwareWalletError,
  getActiveHardwareProvider,
  getHardwareProvider,
} from "@/lib/wallet/hardware";
import { hexToKvnc } from "@/lib/wallet/address";
import { shortId } from "@/lib/ledger/hash";

interface HardwareSignModalProps {
  open: boolean;
  deviceType: HardwareDeviceType;
  accountIndex: number;
  path: string;
  recipient: string;
  amountKvnc: string;
  feeKvnc: string;
  sighash: string;
  onSuccess: (signature: string) => void;
  onCancel: () => void;
}

export function HardwareSignModal({
  open,
  deviceType,
  accountIndex,
  path,
  recipient,
  amountKvnc,
  feeKvnc,
  sighash,
  onSuccess,
  onCancel,
}: HardwareSignModalProps) {
  const [signing, setSigning] = useState(false);
  const [statusText, setStatusText] = useState<string>("Waiting for device confirmation...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startSigning = useCallback(async () => {
    setSigning(true);
    setErrorMessage(null);
    setStatusText(`Waiting for confirmation on your ${deviceType.toUpperCase()} device...`);

    try {
      let provider = getActiveHardwareProvider();
      if (!provider || provider.deviceType !== deviceType || !provider.isConnected()) {
        provider = getHardwareProvider(deviceType);
        if (!provider.isConnected()) {
          setStatusText(`Connecting to ${deviceType.toUpperCase()}...`);
          await provider.connect({ accountIndex, path });
        }
      }

      setStatusText(`Please review transaction details on your ${deviceType.toUpperCase()} screen...`);

      const result = await provider.signTransaction(accountIndex, sighash, {
        onStatusChange: (status) => setStatusText(status),
      });

      setStatusText("Transaction signed successfully!");
      onSuccess(result.signature);
    } catch (err) {
      const msg =
        err instanceof HardwareWalletError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Signing failed on hardware device";
      setErrorMessage(msg);
    } finally {
      setSigning(false);
    }
  }, [deviceType, accountIndex, path, sighash, onSuccess]);

  useEffect(() => {
    if (open && sighash) {
      void startSigning();
    } else {
      setSigning(false);
      setErrorMessage(null);
      setStatusText("Waiting for device confirmation...");
    }
  }, [open, sighash, startSigning]);

  const deviceName =
    deviceType === "ledger"
      ? "Ledger"
      : deviceType === "trezor"
        ? "Trezor"
        : "Mock Simulator";

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && !signing && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-xl border border-border bg-surface p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-accent" />
              <Dialog.Title className="font-display text-lg text-fg">
                Hardware Confirmation
              </Dialog.Title>
            </div>
            {!signing && (
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted hover:text-fg"
                  onClick={onCancel}
                >
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </Dialog.Close>
            )}
          </div>

          <Dialog.Description className="mt-1.5 text-xs text-muted">
            Please verify the transaction details below match the display on your {deviceName} device.
          </Dialog.Description>

          {/* Transaction Summary Card */}
          <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-2/60 p-3.5 text-xs">
            <div className="flex items-center justify-between pb-2.5">
              <span className="text-muted">Amount</span>
              <span className="font-mono text-sm font-semibold text-fg">
                {amountKvnc} KVNC
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-muted">Network Fee</span>
              <span className="font-mono text-fg">{feeKvnc} KVNC</span>
            </div>
            <div className="py-2.5">
              <span className="text-muted">Recipient</span>
              <p className="mt-1 font-mono text-[11px] leading-relaxed break-all text-fg">
                {hexToKvnc(recipient)}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2.5 text-[11px]">
              <span className="text-muted">Derivation Path</span>
              <span className="font-mono text-subtle">{path}</span>
            </div>
            <div className="flex items-center justify-between pt-2 text-[11px]">
              <span className="text-muted">Sighash</span>
              <span className="font-mono text-subtle">{shortId(sighash)}</span>
            </div>
          </div>

          {/* Status & Prompts */}
          {signing && (
            <div className="mt-5 flex flex-col items-center justify-center rounded-lg border border-accent/20 bg-accent/5 p-5 text-center">
              <div className="relative flex items-center justify-center">
                <div className="absolute size-10 rounded-full bg-accent/20 animate-ping" />
                <Loader2 className="size-6 animate-spin text-accent" />
              </div>
              <p className="mt-3 font-medium text-xs text-fg">{statusText}</p>
              <p className="mt-1 text-[11px] text-muted">
                Do not disconnect your {deviceName} during signing.
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">
                <p className="font-medium">Signing Failed</p>
                <p className="mt-0.5 text-[11px] opacity-90">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Modal Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={signing}
              onClick={onCancel}
            >
              Cancel
            </Button>
            {errorMessage && (
              <Button
                type="button"
                disabled={signing}
                onClick={() => void startSigning()}
              >
                Retry on {deviceName}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
