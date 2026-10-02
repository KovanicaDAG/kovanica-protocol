import { useEffect, useState } from "react";
import { Copy, Download, Eye, EyeOff, ShieldCheck, Lock, Unlock, Users, ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AddressQr } from "@/components/wallet/address-qr";
import { api, apiPostJson, useApiSource, isPublic } from "@/lib/api/client";
import { MIN_FEE, TOKEN, isNativeAsset, assetLabel } from "@/lib/api/contract";
import type { ApiHistory, ApiUtxos } from "@/lib/api/contract";
import {
  prepareUrl,
  submitUrl,
  assetOptionsFromUtxos,
  balanceForAsset,
} from "@/lib/api/assets";
import { ATOM } from "@/lib/ledger/types";
import { useLedger } from "@/lib/ledger/store";
import { addressFromMnemonic, createMnemonic, importMnemonic, signSighash } from "@/lib/wallet/keys";
import { hexToKvnc, parseAddr } from "@/lib/wallet/address";
import { encryptMnemonic, decryptMnemonic } from "@/lib/wallet/vault";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

type CoinJoinParticipant = {
  address: string;
  amount: string;
  recipient: string;
  assetId: string | null;
};

type CoinJoinOutput = {
  amount: string;
  to: string;
  assetId: string | null;
};

type CoinJoinPrepared = {
  txHex: string;
  sighashesHex: string[];
  outpointsHex: string[];
  values: string[];
  fee: string;
};

type CoinJoinState = "idle" | "preparing" | "prepared" | "submitting" | "submitted";

export function CoinJoinView() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = isPublic(source);
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;
  const setWallet = useLedger((s) => s.setWallet);

  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<CoinJoinState>("idle");

  // Participant 1 (You)
  const [p1Amount, setP1Amount] = useState("");
  const [p1Recipient, setP1Recipient] = useState("");
  const [p1AssetId, setP1AssetId] = useState<string | null>(null);

  // Participant 2
  const [p2Address, setP2Address] = useState("");
  const [p2Amount, setP2Amount] = useState("");
  const [p2Recipient, setP2Recipient] = useState("");
  const [p2AssetId, setP2AssetId] = useState<string | null>(null);

  // Prepared state
  const [prepared, setPrepared] = useState<CoinJoinPrepared | null>(null);

  // Signatures collection
  const [signatures, setSignatures] = useState<string[]>([]);
  const [newSig, setNewSig] = useState("");

  const balance = 0; // Would fetch from wallet
  const spendable = balance;

  async function prepareCoinJoin() {
    if (!wallet) { toast.error("No wallet connected"); return; }

    const participants: CoinJoinParticipant[] = [];

    // Participant 1 (You)
    if (p1Amount && p1Recipient) {
      const amt = parseKvnc(p1Amount);
      if (amt === null) { toast.error("Invalid amount for Participant 1"); return; }
      participants.push({
        address: wallet.address,
        amount: (amt * ATOM).toString(),
        recipient: p1Recipient.trim(),
        assetId: p1AssetId,
      });
    }

    // Participant 2
    if (p2Address && p2Amount && p2Recipient) {
      const amt = parseKvnc(p2Amount);
      if (amt === null) { toast.error("Invalid amount for Participant 2"); return; }
      participants.push({
        address: p2Address.trim(),
        amount: (amt * ATOM).toString(),
        recipient: p2Recipient.trim(),
        assetId: p2AssetId,
      });
    }

    if (participants.length < 2) {
      toast.error("Need at least 2 participants with amounts and recipients");
      return;
    }

    setBusy(true);
    setState("preparing");
    try {
      const res = await apiPostJson<CoinJoinPrepared>(
        "/api/coinjoin/prepare",
        { participants }
      );
      setPrepared(res);
      setState("prepared");
      toast.success("CoinJoin prepared — share with participants to sign");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Prepare failed");
      setState("idle");
    } finally {
      setBusy(false);
    }
  }

  async function submitCoinJoin() {
    if (!prepared) return;
    if (signatures.length !== prepared.outpointsHex.length) {
      toast.error(`Need ${prepared.outpointsHex.length} signatures`);
      return;
    }

    setBusy(true);
    setState("submitting");
    try {
      await apiPostJson("/api/coinjoin/submit", {
        prepared,
        signaturesHex: signatures,
      });
      setState("submitted");
      toast.success("CoinJoin submitted successfully!");
      setPrepared(null);
      setSignatures([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
      setState("prepared");
    } finally {
      setBusy(false);
    }
  }

  function addSignature() {
    if (newSig.length !== 128) { // 64 bytes = 128 hex chars
      toast.error("Signature must be 64 bytes (128 hex chars)");
      return;
    }
    if (signatures.length >= (prepared?.outpointsHex.length ?? 0)) {
      toast.error("Already have enough signatures");
      return;
    }
    setSignatures([...signatures, newSig]);
    setNewSig("");
  }

  if (!hydrated) return <div>Loading…</div>;
  if (!wallet) return <div className="text-center p-8 text-muted">Connect a wallet first</div>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-fg">CoinJoin</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          CoinJoin combines multiple participants' transactions into a single batch,
          improving privacy by making it harder to link inputs to outputs.
          Each participant provides their inputs and desired outputs, then signs their own inputs.
        </p>
      </header>

      {state === "idle" && (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">Participant 1 (You)</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Amount (KVNC)</label>
                <input
                  value={p1Amount}
                  onChange={(e) => setP1Amount(e.target.value)}
                  placeholder="1.5"
                  inputMode="decimal"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Recipient Address</label>
                <input
                  value={p1Recipient}
                  onChange={(e) => setP1Recipient(e.target.value)}
                  placeholder="kvnc…dag or 64-hex"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">Participant 2</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Participant 2 Address</label>
                <input
                  value={p2Address}
                  onChange={(e) => setP2Address(e.target.value)}
                  placeholder="kvnc…dag or 64-hex"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Amount (KVNC)</label>
                <input
                  value={p2Amount}
                  onChange={(e) => setP2Amount(e.target.value)}
                  placeholder="0.5"
                  inputMode="decimal"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1 block text-xs text-muted">Participant 2 Recipient</label>
              <input
                value={p2Recipient}
                onChange={(e) => setP2Recipient(e.target.value)}
                placeholder="kvnc…dag or 64-hex"
                className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
              />
            </div>
          </section>

          <Button
            className="w-full h-12"
            disabled={busy || !p1Amount || !p1Recipient || !p2Address || !p2Amount || !p2Recipient}
            onClick={prepareCoinJoin}
          >
            {busy ? "Preparing…" : "Prepare CoinJoin"}
          </Button>
        </div>
      )}

      {state === "prepared" && prepared && (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">CoinJoin Prepared — Ready for Signatures</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Transaction</span>
                <span className="font-mono truncate">{prepared.txHex.slice(0, 16)}…{prepared.txHex.slice(-16)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Fee</span>
                <span className="font-mono">{Number(prepared.fee) / ATOM} {TOKEN}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Inputs</span>
                <span className="font-mono">{prepared.outpointsHex.length}</span>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-lg border border-border bg-bg">
              <h4 className="mb-2 font-medium text-fg">Share with Participants</h4>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-muted">Sighash (all inputs share same):</span>
                  <pre className="mt-1 truncate font-mono text-[10px] text-fg">{prepared.sighashesHex[0]}</pre>
                </div>
                <div>
                  <span className="text-muted">Outpoints:</span>
                  <pre className="mt-1 font-mono text-[10px] text-fg">{prepared.outpointsHex.join("\n")}</pre>
                </div>
                <div>
                  <span className="text-muted">Values (atoms):</span>
                  <pre className="mt-1 font-mono text-[10px] text-fg">{prepared.values.join("\n")}</pre>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-lg border border-border bg-bg">
              <h4 className="mb-2 font-medium text-fg">Collect Signatures</h4>
              <div className="space-y-2">
                {prepared.outpointsHex.map((_, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted">Input {idx + 1}:</span>
                    <input
                      value={signatures[idx] ?? ""}
                      onChange={(e) => {
                        const arr = [...signatures];
                        arr[idx] = e.target.value;
                        setSignatures(arr);
                      }}
                      placeholder="64-byte hex signature"
                      className="flex-1 h-10 rounded-md border border-border bg-bg px-3 font-mono text-[11px] text-fg outline-none"
                    />
                  </div>
                ))}
                {signatures.length === prepared.outpointsHex.length && (
                  <Button className="w-full h-12" onClick={submitCoinJoin} disabled={busy}>
                    {busy ? "Submitting…" : "Submit CoinJoin"}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {state === "submitted" && (
        <div className="rounded-xl border border-teal bg-teal/5 p-6 text-center">
          <ShieldCheck className="mx-auto size-12 text-teal" />
          <h2 className="mt-4 text-xl font-medium text-fg">CoinJoin Submitted!</h2>
          <p className="mt-2 text-muted">The batched transaction has been broadcast to the network.</p>
          <Button className="mt-4 w-full max-w-xs" onClick={() => { setState("idle"); setPrepared(null); setSignatures([]); }}>
            Back to CoinJoin
          </Button>
        </div>
      )}
    </div>
  );
}

function parseKvnc(amountKvnc: string): number | null {
  const decimal = parseFloat(amountKvnc.trim());
  if (isNaN(decimal) || decimal <= 0) return null;
  return Math.round(decimal * ATOM);
}