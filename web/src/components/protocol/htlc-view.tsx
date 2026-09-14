import { useState } from "react";
import { Lock, Unlock, Timer, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createHtlc,
  redeemHtlc,
  refundHtlc,
  parseOutpoint,
  type HtlcCreateResult,
} from "@/lib/protocol/htlc";
import { parseKvnc, fmtKvnc } from "@/lib/ledger/format";
import { ATOM } from "@/lib/ledger/types";

/** KVP-104 / RFC-004 — HTLC; redeem/refund require owner secret. */
export function HtlcView() {
  const [tab, setTab] = useState<"create" | "redeem" | "refund">("create");
  const [paymentHash, setPaymentHash] = useState("");
  const [receiverPk, setReceiverPk] = useState("");
  const [amount, setAmount] = useState("1");
  const [timeout, setTimeoutBlocks] = useState("144");
  const [created, setCreated] = useState<HtlcCreateResult | null>(null);
  const [preimage, setPreimage] = useState("");
  const [outpoint, setOutpoint] = useState("");
  const [receiverSecret, setReceiverSecret] = useState("");
  const [senderSecret, setSenderSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);

  async function onCreate() {
    const atoms = parseKvnc(amount);
    if (atoms === null || atoms <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    const blocks = Number(timeout);
    if (!Number.isFinite(blocks) || blocks < 1) {
      toast.error("Timeout must be ≥ 1 block");
      return;
    }
    setBusy(true);
    try {
      const res = await createHtlc({
        paymentHashHex: paymentHash,
        receiverPubkeyHex: receiverPk,
        amountAtoms: atoms,
        timeoutBlocks: blocks,
      });
      setCreated(res);
      toast.success("HTLC address created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem() {
    if (!/^[0-9a-f]{64}$/i.test(receiverSecret.trim())) {
      toast.error("Receiver secret (64 hex) is required");
      return;
    }
    setBusy(true);
    try {
      const { tx, index } = parseOutpoint(outpoint);
      const res = await redeemHtlc({
        outpointTx: tx,
        outpointIndex: index,
        preimageHex: preimage,
        receiverSecretHex: receiverSecret.trim(),
      });
      setLastTx(res.txIdHex);
      setReceiverSecret("");
      toast.success(`Redeemed · ${res.txIdHex.slice(0, 16)}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Redeem failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRefund() {
    if (!/^[0-9a-f]{64}$/i.test(senderSecret.trim())) {
      toast.error("Sender secret (64 hex) is required");
      return;
    }
    setBusy(true);
    try {
      const { tx, index } = parseOutpoint(outpoint);
      const res = await refundHtlc({
        outpointTx: tx,
        outpointIndex: index,
        senderSecretHex: senderSecret.trim(),
      });
      setLastTx(res.txIdHex);
      setSenderSecret("");
      toast.success(`Refunded · ${res.txIdHex.slice(0, 16)}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-8 md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-blue uppercase">KVP-104 · RFC-004</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">HTLC</h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Hashed time-locked contracts. Redeem and refund require the owner secret.
      </p>
      <div className="mt-8 inline-flex rounded-md bg-surface-2 p-0.5">
        {([
          { id: "create" as const, label: "Create", icon: Lock },
          { id: "redeem" as const, label: "Redeem", icon: Unlock },
          { id: "refund" as const, label: "Refund", icon: Timer },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "inline-flex h-9 items-center gap-1.5 rounded-sm bg-bg px-3 text-sm font-medium text-fg"
                : "inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium text-muted hover:text-fg"
            }
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-4 rounded-xl border border-border bg-surface p-5">
        {tab === "create" && (
          <>
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Payment hash (64 hex)"
              value={paymentHash}
              onChange={(e) => setPaymentHash(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Receiver pubkey"
              value={receiverPk}
              onChange={(e) => setReceiverPk(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount KVNC"
              />
              <input
                type="number"
                className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
                value={timeout}
                onChange={(e) => setTimeoutBlocks(e.target.value)}
                placeholder="Timeout blocks"
              />
            </div>
            <Button disabled={busy} onClick={() => void onCreate()}>
              <Shuffle className="mr-2 size-4" />
              {busy ? "Building…" : "Create HTLC"}
            </Button>
            {created && (
              <p className="break-all font-mono text-xs">
                {created.address} · {fmtKvnc(created.amountAtoms)}
              </p>
            )}
            <p className="text-xs text-subtle">
              POST /api/htlc/create · 1 KVNC = {ATOM.toLocaleString()} atoms
            </p>
          </>
        )}
        {tab === "redeem" && (
          <>
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Preimage 64 hex"
              value={preimage}
              onChange={(e) => setPreimage(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="txid:index"
              value={outpoint}
              onChange={(e) => setOutpoint(e.target.value)}
            />
            <input
              type="password"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Receiver secret 64 hex (required)"
              value={receiverSecret}
              onChange={(e) => setReceiverSecret(e.target.value)}
            />
            <Button disabled={busy} onClick={() => void onRedeem()}>
              {busy ? "…" : "Redeem"}
            </Button>
            {lastTx && <p className="font-mono text-xs">{lastTx}</p>}
          </>
        )}
        {tab === "refund" && (
          <>
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="txid:index"
              value={outpoint}
              onChange={(e) => setOutpoint(e.target.value)}
            />
            <input
              type="password"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Sender secret 64 hex (required)"
              value={senderSecret}
              onChange={(e) => setSenderSecret(e.target.value)}
            />
            <Button variant="outline" disabled={busy} onClick={() => void onRefund()}>
              {busy ? "…" : "Refund"}
            </Button>
            {lastTx && <p className="font-mono text-xs">{lastTx}</p>}
          </>
        )}
      </div>
    </main>
  );
}
