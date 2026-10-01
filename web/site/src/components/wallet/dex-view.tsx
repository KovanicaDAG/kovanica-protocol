/**
 * DexView — HTLC-based decentralized exchange UI.
 * Simplified maker/taker flow: create offer → fund → claim/refund.
 */
import { useEffect, useState } from "react";
import { Copy, ShieldCheck, Lock, Unlock, ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, apiPostJson, useApiSource, isPublic } from "@/lib/api/client";
import { MIN_FEE, TOKEN } from "@/lib/api/contract";
import { ATOM } from "@/lib/ledger/types";
import { useLedger } from "@/lib/ledger/store";
import { signSighash } from "@/lib/wallet/keys";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

type DexRole = "maker" | "taker";
type DexState = "idle" | "creating" | "offer_created" | "funding" | "claiming" | "refunding" | "completed";

type DexOffer = {
  version: number;
  maker: string;
  give_asset: string;
  give_amount: string;
  take_asset: string;
  take_amount: string;
  payment_hash: string;
  timeout_height: number;
};

type HtlcInfo = {
  tx_hex: string;
  sighash: string;
  htlc_address: string;
  script_hex: string;
  outpoint: { tx: string; index: number };
  value: number;
  fee: number;
};

export function DexView() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = isPublic(source);
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DexState>("idle");
  const [role, setRole] = useState<DexRole>("maker");

  // Form inputs
  const [giveAmount, setGiveAmount] = useState("");
  const [giveAsset, setGiveAsset] = useState("native");
  const [takeAmount, setTakeAmount] = useState("");
  const [takeAsset, setTakeAsset] = useState("native");
  const [recipient, setRecipient] = useState("");
  const [timeoutBlocks, setTimeoutBlocks] = useState("100");

  // Offer + HTLC state
  const [offer, setOffer] = useState<DexOffer | null>(null);
  const [offerJson, setOfferJson] = useState("");
  const [htlc, setHtlc] = useState<HtlcInfo | null>(null);
  const [preimageHex, setPreimageHex] = useState("");
  const [tipHeight, setTipHeight] = useState<number | null>(null);

  async function refreshTip() {
    try {
      const head = await api<{ blocks: number }>("/api/head");
      setTipHeight(head.blocks);
    } catch {
      setTipHeight(null);
    }
  }

  useEffect(() => {
    void refreshTip();
  }, []);

  function parseKvnc(amountKvnc: string): number | null {
    const decimal = parseFloat(amountKvnc.trim());
    if (isNaN(decimal) || decimal <= 0) return null;
    return Math.round(decimal * ATOM);
  }

  async function createOffer() {
    if (!wallet) { toast.error("Connect a wallet first"); return; }
    if (!giveAmount || !takeAmount || !recipient) {
      toast.error("Fill all fields");
      return;
    }
    const giveAtoms = parseKvnc(giveAmount);
    const takeAtoms = parseKvnc(takeAmount);
    if (giveAtoms === null || takeAtoms === null) {
      toast.error("Invalid amount");
      return;
    }
    const timeout = parseInt(timeoutBlocks, 10);
    if (isNaN(timeout) || timeout <= 0) {
      toast.error("Invalid timeout");
      return;
    }

    setBusy(true);
    setState("creating");
    try {
      // Generate preimage + BLAKE3 hash
      const preimageBytes = new Uint8Array(32);
      crypto.getRandomValues(preimageBytes);
      const preimage = bytesToHex(preimageBytes);
      const paymentHash = bytesToHex(blake3(preimageBytes));
      setPreimageHex(preimage);

      const newOffer: DexOffer = {
        version: 1,
        maker: wallet.address,
        give_asset: giveAsset,
        give_amount: giveAtoms.toString(),
        take_asset: takeAsset,
        take_amount: takeAtoms.toString(),
        payment_hash: paymentHash,
        timeout_height: timeout,
      };
      setOffer(newOffer);
      setOfferJson(JSON.stringify(newOffer, null, 2));
      setState("offer_created");
      toast.success("Offer created — share with counterparty");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create offer");
      setState("idle");
    } finally {
      setBusy(false);
    }
  }

  async function fundHtlc() {
    if (!offer || !wallet) return;
    const amountAtoms = parseKvnc(giveAmount);
    if (amountAtoms === null) { toast.error("Invalid amount"); return; }
    setBusy(true);
    setState("funding");
    try {
      const prepared = await apiPostJson<HtlcInfo>("/api/htlc/prepare", {
        from: wallet.address,
        amount: amountAtoms,
        recipient_pk: recipient,
        preimage_hash: offer.payment_hash,
        timeout: offer.timeout_height,
      });
      setHtlc(prepared);

      if (wallet.mnemonic) {
        const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
        const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
          tx_hex: prepared.tx_hex,
          signature_hex: sig,
        });
        const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
          tx_hex: finalized.signed_tx_hex,
        });
        toast.success(`HTLC funded — tx ${submitted.tx}`);
      } else {
        toast.info("HTLC prepared — sign offline to submit");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Funding failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  async function claimHtlc() {
    if (!htlc || !wallet || !preimageHex) {
      toast.error("HTLC and preimage required");
      return;
    }
    if (!wallet.mnemonic) {
      toast.info("Claim requires a software wallet");
      return;
    }
    setBusy(true);
    setState("claiming");
    try {
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/htlc/spend",
        {
          outpoint_tx: htlc.outpoint.tx,
          outpoint_index: htlc.outpoint.index,
          script_hex: htlc.script_hex,
          to: wallet.address,
          kind: "redeem",
          preimage_hex: preimageHex,
        }
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
        tx_hex: prepared.tx_hex,
        script_hex: htlc.script_hex,
        kind: "redeem",
        preimage_hex: preimageHex,
        signature_hex: sig,
      });
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      toast.success(`Claimed! Preimage revealed on-chain: tx ${submitted.tx}`);
      setState("completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  async function refundHtlc() {
    if (!htlc || !wallet) return;
    if (!wallet.mnemonic) {
      toast.info("Refund requires a software wallet");
      return;
    }
    await refreshTip();
    if (offer && tipHeight !== null && tipHeight < offer.timeout_height) {
      toast.error(`Timeout not reached — height ${tipHeight} < ${offer.timeout_height}`);
      return;
    }
    setBusy(true);
    setState("refunding");
    try {
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/htlc/spend",
        {
          outpoint_tx: htlc.outpoint.tx,
          outpoint_index: htlc.outpoint.index,
          script_hex: htlc.script_hex,
          to: wallet.address,
          kind: "refund",
        }
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
        tx_hex: prepared.tx_hex,
        script_hex: htlc.script_hex,
        kind: "refund",
        signature_hex: sig,
      });
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      toast.success(`Refunded — tx ${submitted.tx}`);
      setState("completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refund failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  function loadOffer() {
    try {
      const parsed = JSON.parse(offerJson) as DexOffer;
      setOffer(parsed);
      setState("offer_created");
      toast.success("Offer loaded");
    } catch {
      toast.error("Invalid offer JSON");
    }
  }

  if (!hydrated) return <div className="p-8 text-center text-muted">Loading…</div>;
  if (!wallet) return <div className="p-8 text-center text-muted">Connect a wallet first</div>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-fg">DEX</h1>
        <p className="mt-2 text-sm text-muted">
          Trustless atomic swaps via HTLCs. Create an offer, fund it, and trade peer-to-peer.
        </p>
      </header>

      {/* Role selector */}
      <div className="flex gap-2">
        <Button
          variant={role === "maker" ? "default" : "ghost"}
          onClick={() => setRole("maker")}
          className="flex-1"
        >
          <ArrowLeftRight className="size-4 mr-2" /> Maker
        </Button>
        <Button
          variant={role === "taker" ? "default" : "ghost"}
          onClick={() => setRole("taker")}
          className="flex-1"
        >
          <Unlock className="size-4 mr-2" /> Taker
        </Button>
      </div>

      {/* Maker: create offer */}
      {role === "maker" && state === "idle" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">Create Offer</h2>
            <div className="grid gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted">You Give (KVNC)</label>
                <input
                  value={giveAmount}
                  onChange={(e) => setGiveAmount(e.target.value)}
                  placeholder="10"
                  inputMode="decimal"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">You Receive (KVNC)</label>
                <input
                  value={takeAmount}
                  onChange={(e) => setTakeAmount(e.target.value)}
                  placeholder="5"
                  inputMode="decimal"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Counterparty Address</label>
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="kvnc…dag or 64-hex"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Timeout (blocks)</label>
                <input
                  value={timeoutBlocks}
                  onChange={(e) => setTimeoutBlocks(e.target.value)}
                  placeholder="100"
                  inputMode="numeric"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
            </div>
            <Button
              className="mt-4 h-12 w-full"
              disabled={busy || !giveAmount || !takeAmount || !recipient}
              onClick={() => void createOffer()}
            >
              {busy ? "Creating…" : "Create Offer & Generate Preimage"}
            </Button>
          </section>
        </div>
      )}

      {/* Taker: load offer */}
      {role === "taker" && state === "idle" && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-medium text-fg">Load Offer</h2>
          <p className="mb-3 text-sm text-muted">Paste the offer JSON from the maker.</p>
          <textarea
            value={offerJson}
            onChange={(e) => setOfferJson(e.target.value)}
            placeholder='{"version":1,"maker":"…","give_amount":"…",…}'
            rows={8}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none resize-none"
          />
          <Button
            className="mt-4 h-12 w-full"
            disabled={busy || !offerJson}
            onClick={() => loadOffer()}
          >
            Load Offer
          </Button>
        </section>
      )}

      {/* Offer created — show details + fund */}
      {state === "offer_created" && offer && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">Offer Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Give</span>
                <span className="font-mono">
                  {Number(offer.give_amount) / ATOM} {offer.give_asset === "native" ? TOKEN : offer.give_asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Receive</span>
                <span className="font-mono">
                  {Number(offer.take_amount) / ATOM} {offer.take_asset === "native" ? TOKEN : offer.take_asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Timeout</span>
                <span className="font-mono">
                  {offer.timeout_height} blocks
                  {tipHeight !== null && (
                    <span className="text-muted"> (tip: {tipHeight})</span>
                  )}
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-bg p-3">
              <h4 className="mb-1 text-xs font-medium text-muted">Preimage (KEEP SECRET)</h4>
              <pre className="truncate font-mono text-[10px] text-fg">{preimageHex || "—"}</pre>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-bg p-3">
              <h4 className="mb-1 text-xs font-medium text-muted">Offer JSON (share with counterparty)</h4>
              <pre className="max-h-32 overflow-auto font-mono text-[10px] text-fg">{offerJson}</pre>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void navigator.clipboard.writeText(offerJson)}
              >
                <Copy className="size-3.5 mr-1" /> Copy
              </Button>
            </div>
          </section>

          <Button
            className="h-12 w-full"
            disabled={busy}
            onClick={() => void fundHtlc()}
          >
            {busy ? "Funding…" : "Fund HTLC"}
          </Button>
        </div>
      )}

      {/* HTLC funded — claim/refund */}
      {(state === "offer_created" || state === "funding") && htlc && (
        <div className="space-y-4">
          <section className="rounded-xl border border-teal bg-teal/5 p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">HTLC Funded</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">HTLC Address</span>
                <span className="font-mono truncate">{htlc.htlc_address.slice(0, 20)}…</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Value</span>
                <span className="font-mono">{Number(htlc.value) / ATOM} KVNC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Outpoint</span>
                <span className="font-mono truncate">{htlc.outpoint.tx.slice(0, 20)}…#{htlc.outpoint.index}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !preimageHex}
                onClick={() => void claimHtlc()}
              >
                <Unlock className="size-3.5 mr-1" /> Claim (reveal preimage)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void refundHtlc()}
              >
                <Lock className="size-3.5 mr-1" /> Refund (after timeout)
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* Completed */}
      {state === "completed" && (
        <div className="rounded-xl border border-teal bg-teal/5 p-6 text-center">
          <ShieldCheck className="mx-auto size-12 text-teal" />
          <h2 className="mt-4 text-xl font-medium text-fg">Swap Completed!</h2>
          <p className="mt-2 text-sm text-muted">The atomic swap has been completed successfully.</p>
          <Button
            className="mt-4 w-full max-w-xs"
            onClick={() => {
              setState("idle");
              setOffer(null);
              setHtlc(null);
              setOfferJson("");
              setPreimageHex("");
            }}
          >
            New Swap
          </Button>
        </div>
      )}
    </div>
  );
}
