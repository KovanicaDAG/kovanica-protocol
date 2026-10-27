import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { useEffect } from "react";

type Props = {
  sighash: string;
  onSign: (sig: string) => void;
  onCancel: () => void;
};

export function HardwareWalletFlow({ sighash, onSign, onCancel }: Props) {
  const [method, setMethod] = useState<"select" | "ledger" | "trezor" | "qr">("select");
  const [qrUrl, setQrUrl] = useState("");
  const [sigInput, setSigInput] = useState("");

  useEffect(() => {
    if (method === "qr") {
      QRCode.toDataURL(sighash, { margin: 2, scale: 6 }).then(setQrUrl).catch(console.error);
    }
  }, [method, sighash]);

  async function fakeConnect(name: string) {
    toast.info(`Connecting to ${name}...`);
    await new Promise((r) => setTimeout(r, 1500));
    toast.error(`${name} bridge not found. Make sure the Kovanica App is open.`);
  }

  if (method === "select") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
        <h2 className="text-xl font-display text-fg">Hardware Wallet</h2>
        <p className="text-sm text-muted">Select how you want to sign this transaction.</p>
        <div className="grid gap-3">
          <Button variant="outline" className="h-14 justify-start text-left" onClick={() => { setMethod("ledger"); fakeConnect("Ledger Nano"); }}>
            <span className="font-medium">Ledger Nano</span>
            <span className="ml-auto text-xs text-subtle">WebUSB</span>
          </Button>
          <Button variant="outline" className="h-14 justify-start text-left" onClick={() => { setMethod("trezor"); fakeConnect("Trezor"); }}>
            <span className="font-medium">Trezor</span>
            <span className="ml-auto text-xs text-subtle">TrezorConnect</span>
          </Button>
          <Button variant="outline" className="h-14 justify-start text-left" onClick={() => setMethod("qr")}>
            <span className="font-medium">Air-gapped QR Code</span>
            <span className="ml-auto text-xs text-subtle">Cold Wallet</span>
          </Button>
        </div>
        <Button variant="ghost" className="mt-4" onClick={onCancel}>Cancel</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <h2 className="text-xl font-display text-fg capitalize">{method} Signing</h2>
      
      {method === "qr" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6">
          <p className="text-center text-sm text-muted">
            Scan this payload on your offline cold wallet device.
          </p>
          {qrUrl && <img src={qrUrl} alt="QR" className="size-48 rounded-md bg-white" />}
          <div className="flex w-full items-center gap-2 rounded-md bg-bg p-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono text-subtle">{sighash}</span>
            <button onClick={() => { navigator.clipboard.writeText(sighash); toast.success("Copied"); }} className="p-1 text-muted hover:text-fg">
              <Copy className="size-4" />
            </button>
          </div>
          
          <div className="w-full mt-4">
            <label className="text-xs text-muted">Paste Signature (from Cold Wallet)</label>
            <input
              value={sigInput}
              onChange={(e) => setSigInput(e.target.value)}
              placeholder="128-char hex signature..."
              className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none"
            />
          </div>
          <Button 
            className="w-full mt-2" 
            disabled={sigInput.length < 128} 
            onClick={() => onSign(sigInput.trim())}
          >
            Submit Signature
          </Button>
        </div>
      )}

      {(method === "ledger" || method === "trezor") && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6 text-center">
          <div className="size-12 animate-pulse rounded-full bg-accent/20 flex items-center justify-center text-accent">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" /></svg>
          </div>
          <p className="text-sm text-fg">Waiting for device...</p>
          <p className="text-xs text-muted">
            Please connect your {method === "ledger" ? "Ledger" : "Trezor"} and open the Kovanica app.
          </p>
        </div>
      )}

      <Button variant="ghost" onClick={() => setMethod("select")}>Back to Methods</Button>
    </div>
  );
}
