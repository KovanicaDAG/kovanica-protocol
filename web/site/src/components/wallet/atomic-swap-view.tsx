import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, ShieldCheck, Lock, Unlock, Users, ArrowLeftRight, Loader2, QrCode, Scan, X } from "lucide-react";
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
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { hexToKvnc, parseAddr } from "@/lib/wallet/address";
import { encryptMnemonic, decryptMnemonic } from "@/lib/wallet/vault";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { ConnectHardwareModal } from "@/components/wallet/connect-hardware-modal";

type AtomicSwapRole = "maker" | "taker";

type AtomicSwapOffer = {
  version: number;
  maker: string;
  give: { asset_id: string; amount: string };
  take: { asset_id: string; amount: string };
  payment_hash: string;
  timeout_height: number;
  expires_at: string;
  signature?: string;
};

type AtomicSwapState = "idle" | "creating_offer" | "offer_created" | "funding_htlc_a" | "funding_htlc_b" | "claiming_htlc_a" | "claiming_htlc_b" | "refunding" | "completed";

type SwapOffer = {
  maker_address: string;
  give_asset: string;
  give_amount: string;
  take_asset: string;
  take_amount: string;
  payment_hash: string;
  timeout_height: number;
  expires_at: string;
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

type SwapStatus = {
  ok: boolean;
  balance: number;
  redeem_tx: string | null;
  preimage: string | null;
};

export function AtomicSwapView() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = isPublic(source);
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;
  const setWallet = useLedger((s) => s.setWallet);

  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<AtomicSwapState>("idle");
const [role, setRole] = useState<AtomicSwapRole>("maker");
const [showConnectModal, setShowConnectModal] = useState(false);

// Maker inputs
  const [p1Amount, setP1Amount] = useState("");
  const [p1Recipient, setP1Recipient] = useState("");
  const [p1AssetId, setP1AssetId] = useState<string | null>(null);

  // Taker inputs
  const [p2Address, setP2Address] = useState("");
  const [p2Amount, setP2Amount] = useState("");
  const [p2Recipient, setP2Recipient] = useState("");
  const [p2AssetId, setP2AssetId] = useState<string | null>(null);

  // Offer state
  const [offer, setOffer] = useState<AtomicSwapOffer | null>(null);
  const [offerJson, setOfferJson] = useState<string>("");

  // HTLC states
  const [htlcA, setHtlcA] = useState<HtlcInfo | null>(null);
  const [htlcB, setHtlcB] = useState<HtlcInfo | null>(null);
  const [preimage, setPreimage] = useState<string>("");
  const [preimageHex, setPreimageHex] = useState<string>("");

  // Signatures
  const [signatures, setSignatures] = useState<string[]>([]);

  // HTLC on-chain status (M1.5)
  const [htlcStatus, setHtlcStatus] = useState<SwapStatus | null>(null);

  // Chain height (M1.6) — gates refunds: HTLC timeout is an absolute height.
  const [tipBlocks, setTipBlocks] = useState<number | null>(null);

  async function refreshTip() {
    try {
      const head = await api<{ blocks: number }>("/api/head", "GET");
      setTipBlocks(head.blocks);
    } catch {
      setTipBlocks(null);
    }
  }

  useEffect(() => {
    void refreshTip();
  }, []);

  const balance = 0;

  async function generatePreimage() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = bytesToHex(bytes);
    setPreimage(hex);
    setPreimageHex(hex);
    return bytesToHex(blake3(bytes));
  }

  async function createOffer() {
    if (!wallet) { toast.error("No wallet connected"); return; }

    const participants: SwapOffer[] = [];

    // Maker (Participant 1)
    if (!p1Amount || !p1Recipient) { toast.error("Fill amount and recipient for Participant 1"); return; }
    const amt1 = parseKvnc(p1Amount);
    if (amt1 === null) { toast.error("Invalid amount for Participant 1"); return; }

    // Taker (Participant 2)
    if (!p2Address || !p2Amount || !p2Recipient) { toast.error("Fill all Participant 2 fields"); return; }
    const amt2 = parseKvnc(p2Amount);
    if (amt2 === null) { toast.error("Invalid amount for Participant 2"); return; }

    const participant1: SwapOffer = {
      maker_address: wallet.address,
      give_asset: p1AssetId ?? "native",
      give_amount: amt1.toString(),
      take_asset: p2AssetId ?? "native",
      take_amount: amt2.toString(),
      payment_hash: "",
      timeout_height: 0,
      expires_at: "",
    };
    participants.push(participant1);

    const participant2: SwapOffer = {
      maker_address: p2Address.trim(),
      give_asset: p2AssetId ?? "native",
      give_amount: amt2.toString(),
      take_asset: p1AssetId ?? "native",
      take_amount: amt1.toString(),
      payment_hash: "",
      timeout_height: 0,
      expires_at: "",
    };
    participants.push(participant2);

    if (participants.length < 2) { toast.error("Need at least 2 participants"); return; }

    setBusy(true);
    setState("creating_offer");
    try {
      // Generate preimage and its BLAKE3 hash (the ledger commits BLAKE3(preimage))
      const paymentHash = await generatePreimage();
      
      const offer: AtomicSwapOffer = {
        version: 1,
        maker: wallet.address,
        give: { asset_id: p1AssetId ?? "native", amount: amt1.toString() },
        take: { asset_id: p2AssetId ?? "native", amount: amt2.toString() },
        payment_hash: paymentHash,
        timeout_height: 100,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      
      setOffer(offer);
      setOfferJson(JSON.stringify(offer, null, 2));
      setState("offer_created");
      toast.success("Offer created — share with counterparty");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Offer creation failed");
      setState("idle");
    } finally {
      setBusy(false);
    }
  }

async function fundHtlcA() {
    if (!offer || !wallet) return;
    const amountAtoms = parseKvnc(p1Amount);
    if (amountAtoms === null) { toast.error("Invalid amount for Participant 1"); return; }
    setBusy(true);
    setState("funding_htlc_a");
    try {
      // 1. Prepare (unsigned) funding tx. The node never sees the secret key.
      const prepared = await apiPostJson<HtlcInfo>(
        "/api/htlc/prepare",
        {
          from: wallet.address,
          amount: amountAtoms,
          recipient_pk: p2Address.trim(),
          preimage_hash: offer.payment_hash,
          timeout: offer.timeout_height,
        }
      );
      setHtlcA(prepared);
      setState("funding_htlc_b");
      toast.success("HTLC-A prepared — sign the sighash with your wallet");

      // 2. Sign the sighash locally (software wallet) — keys never leave the browser.
      if (wallet.mnemonic) {
        const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
        // 3. Attach the signature and submit the fully-signed tx.
        const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
          tx_hex: prepared.tx_hex,
          signature_hex: sig,
        });
        const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
          tx_hex: finalized.signed_tx_hex,
        });
        toast.success(`HTLC-A funded — tx ${submitted.tx}`);
      } else {
        toast.info("Sighash prepared — sign offline and submit via /api/submit_tx");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "HTLC-A preparation failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  async function checkHtlcStatus(target: HtlcInfo) {
    setBusy(true);
    try {
      const res = await apiPostJson<SwapStatus>(
        "/api/htlc/status",
        { script_hex: target.script_hex, from_height: 0 }
      );
      setHtlcStatus(res);
      toast.success(res.redeem_tx ? "HTLC redeemed!" : `HTLC locked — ${Number(res.balance) / ATOM} KVNC`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status check failed");
    } finally {
      setBusy(false);
    }
  }

  // M1.6: recover the preimage from an on-chain redeem instead of copy-paste.
  // A claimed HTLC reveals preimage bytes on the ledger; verify they commit to
  // the offer's payment hash, then unlock the claims.
  async function scrapePreimage(observed: HtlcInfo) {
    setBusy(true);
    try {
      const res = await apiPostJson<SwapStatus>(
        "/api/htlc/status",
        { script_hex: observed.script_hex, from_height: 0 }
      );
      setHtlcStatus(res);
      if (!res.redeem_tx || !res.preimage) {
        toast.info("No redeem on-chain yet — nothing to scrape");
        return;
      }
      if (offer && bytesToHex(blake3(hexToBytes(res.preimage))) !== offer.payment_hash) {
        toast.error("Scraped preimage does not commit to the offer's payment hash");
        return;
      }
      setPreimage(res.preimage);
      setPreimageHex(res.preimage);
      toast.success("Preimage scraped from chain — claims unlocked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preimage scrape failed");
    } finally {
      setBusy(false);
    }
  }

  async function fundHtlcB() {
    if (!offer || !wallet) return;
    const amountAtoms = parseKvnc(p2Amount);
    if (amountAtoms === null) { toast.error("Invalid amount for Participant 2"); return; }
    setBusy(true);
    setState("funding_htlc_b");
    try {
      const prepared = await apiPostJson<HtlcInfo>(
        "/api/htlc/prepare",
        {
          from: p2Address.trim(),
          amount: amountAtoms,
          recipient_pk: wallet.address,
          preimage_hash: offer.payment_hash,
          timeout: offer.timeout_height,
        }
      );
      setHtlcB(prepared);
      if (wallet.mnemonic) {
        const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
        const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
          tx_hex: prepared.tx_hex,
          signature_hex: sig,
        });
        const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
          tx_hex: finalized.signed_tx_hex,
        });
        toast.success(`HTLC-B funded — tx ${submitted.tx}`);
      } else {
        toast.info("HTLC-B prepared — sign offline and submit via /api/submit_tx");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "HTLC-B preparation failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  async function claimHtlcA() {
    if (!htlcA || !wallet) return;
    if (!preimageHex) { toast.error("Preimage missing — create an offer to generate one"); return; }
    if (!wallet.mnemonic) { toast.info("Claim requires a software wallet to sign locally"); return; }
    setBusy(true);
    setState("claiming_htlc_a");
    try {
      // The taker reveals the preimage and claims HTLC-A: prepare an unsigned
      // redeem, sign the sighash in the browser, finalize, and submit.
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/htlc/spend",
        {
          outpoint_tx: htlcA.outpoint.tx,
          outpoint_index: htlcA.outpoint.index,
          script_hex: htlcA.script_hex,
          to: wallet.address,
          kind: "redeem",
          preimage_hex: preimageHex,
        }
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
        tx_hex: prepared.tx_hex,
        script_hex: htlcA.script_hex,
        kind: "redeem",
        preimage_hex: preimageHex,
        signature_hex: sig,
      });
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      toast.success(`HTLC-A claimed — preimage revealed on-chain: tx ${submitted.tx}`);
      setState("completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  async function claimHtlcB() {
    if (!htlcB || !wallet) return;
    if (!preimageHex) { toast.error("Preimage missing — create an offer to generate one"); return; }
    if (!wallet.mnemonic) { toast.info("Claim requires a software wallet to sign locally"); return; }
    setBusy(true);
    setState("claiming_htlc_b");
    try {
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/htlc/spend",
        {
          outpoint_tx: htlcB.outpoint.tx,
          outpoint_index: htlcB.outpoint.index,
          script_hex: htlcB.script_hex,
          to: wallet.address,
          kind: "redeem",
          preimage_hex: preimageHex,
        }
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
        tx_hex: prepared.tx_hex,
        script_hex: htlcB.script_hex,
        kind: "redeem",
        preimage_hex: preimageHex,
        signature_hex: sig,
      });
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      toast.success(`HTLC-B claimed — you now hold both sides: tx ${submitted.tx}`);
      setState("completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  async function refundHtlcA() {
    if (!htlcA || !wallet) return;
    if (!wallet.mnemonic) { toast.info("Refund requires a software wallet to sign locally"); return; }
    await refreshTip();
    if (offer && tipBlocks !== null && tipBlocks < offer.timeout_height) {
      toast.error(`Timeout not reached — chain height ${tipBlocks} < ${offer.timeout_height}`);
      return;
    }
    setBusy(true);
    setState("refunding");
    try {
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/htlc/spend",
        {
          outpoint_tx: htlcA.outpoint.tx,
          outpoint_index: htlcA.outpoint.index,
          script_hex: htlcA.script_hex,
          to: wallet.address,
          kind: "refund",
        }
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
        tx_hex: prepared.tx_hex,
        script_hex: htlcA.script_hex,
        kind: "refund",
        signature_hex: sig,
      });
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      toast.success(`HTLC-A refunded — tx ${submitted.tx}`);
      setState("completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refund failed (timeout not reached?)");
      setState("offer_created");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <div className="text-center p-8 text-muted">Loading…</div>;
  if (!wallet) return <div className="text-center p-8 text-muted">Connect a wallet first</div>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-tight text-fg">Atomic Swap</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Trustless peer-to-peer asset exchange using HTLCs. Create an offer, fund HTLCs, and swap atomically.
            </p>
          </div>
        </div>
      </header>

      {state === "idle" && (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-medium text-fg">Your Role</h2>
              <div className="flex gap-2">
                <Button
                  variant={role === "maker" ? "default" : "ghost"}
                  onClick={() => setRole("maker")}
                  className="flex items-center gap-2"
                >
                  <Users className="size-4" /> Maker (Create Offer)
                </Button>
                <Button
                  variant={role === "taker" ? "default" : "ghost"}
                  onClick={() => setRole("taker")}
                  className="flex items-center gap-2"
                >
                  <Users className="size-4" /> Taker (Take Offer)
                </Button>
              </div>
            </div>
          </section>

          {role === "maker" && (
            <>
              <section className="rounded-xl border border-border bg-surface p-6">
                <h2 className="mb-4 text-lg font-medium text-fg">Create Swap Offer</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted">Amount to Give (KVNC)</label>
                    <input
                      value={p1Amount}
                      onChange={(e) => setP1Amount(e.target.value)}
                      placeholder="10"
                      inputMode="decimal"
                      className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">Recipient Address (Taker)</label>
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
                <h2 className="mb-4 text-lg font-medium text-fg">Counterparty (Taker) Info</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted">Taker Address</label>
                    <input
                      value={p2Address}
                      onChange={(e) => setP2Address(e.target.value)}
                      placeholder="kvnc…dag or 64-hex"
                      className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">Amount to Receive (KVNC)</label>
                    <input
                      value={p2Amount}
                      onChange={(e) => setP2Amount(e.target.value)}
                      placeholder="5"
                      inputMode="decimal"
                      className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-1 block text-xs text-muted">Taker Recipient Address</label>
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
                onClick={createOffer}
              >
                {busy ? "Creating Offer…" : "Create Offer & Generate Preimage"}
              </Button>
            </>
          )}
        </div>
      )}

      {state === "offer_created" && offer && (
              <div className="space-y-6">
              <section className="rounded-xl border border-border bg-surface p-6">
                <h2 className="mb-4 text-lg font-medium text-fg">Offer Created — Ready to Share</h2>
                
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Maker</span>
                    <span className="font-mono truncate">{offer.maker.slice(0, 16)}…{offer.maker.slice(-16)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Give</span>
                    <span className="font-mono">{Number(offer.give.amount) / ATOM} {offer.give.asset_id === "native" ? TOKEN : offer.give.asset_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Take</span>
                    <span className="font-mono">{Number(offer.take.amount) / ATOM} {offer.take.asset_id === "native" ? TOKEN : offer.take.asset_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Timeout Height</span>
                    <span className="font-mono">{offer.timeout_height}</span>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-lg border border-border bg-bg">
                  <h4 className="mb-2 font-medium text-fg">Preimage Hash (Payment Hash)</h4>
                  <pre className="truncate font-mono text-[10px] text-fg">{offer.payment_hash}</pre>
                </div>

                <div className="mt-4 p-3 rounded-lg border border-border bg-bg">
                  <h4 className="mb-2 font-medium text-fg">Preimage (KEEP SECRET!)</h4>
                  <p className="text-xs text-muted mb-2">Share this ONLY when claiming the counterparty's HTLC. Never share before!</p>
                  <div className="space-y-2">
                    <div>
                      <label className="mb-1 block text-xs text-muted">Preimage (64 hex chars)</label>
                      <input
                        value={preimageHex}
                        onChange={(e) => setPreimageHex(e.target.value)}
                        className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-[11px] text-fg outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-lg border border-border bg-bg">
                  <h4 className="mb-2 font-medium text-fg">Offer JSON (Share with Counterparty)</h4>
                  <pre className="truncate font-mono text-[10px] text-fg max-h-48 overflow-auto">{offerJson}</pre>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => navigator.clipboard.writeText(offerJson)}>
                    <Copy className="size-3.5 mr-1" /> Copy Offer JSON
                  </Button>
                </div>
              </section>

              {htlcA && (
                <section className="rounded-xl border border-teal bg-teal/5 p-6">
                  <h2 className="mb-4 text-lg font-medium text-fg">HTLC-A (Your Funded HTLC)</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Transaction</span>
                      <span className="font-mono truncate">{htlcA.tx_hex.slice(0, 16)}…{htlcA.tx_hex.slice(-16)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">HTLC Address</span>
                      <span className="font-mono truncate">{htlcA.htlc_address.slice(0, 16)}…</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Sighash (Sign This)</span>
                      <span className="font-mono truncate">{htlcA.sighash.slice(0, 16)}…</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Outpoint</span>
                      <span className="font-mono truncate">{htlcA.outpoint.tx.slice(0, 20)}…#{htlcA.outpoint.index}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Value</span>
                      <span className="font-mono">{Number(htlcA.value) / ATOM} KVNC</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Fee</span>
                      <span className="font-mono">{Number(htlcA.fee) / ATOM} KVNC</span>
                    </div>
                    {offer && (
                      <div className="flex justify-between">
                        <span className="text-muted">Timeout (refund at height)</span>
                        <span className="font-mono">
                          {offer.timeout_height}
                          <span className="text-muted"> / tip {tipBlocks ?? "…"}</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 p-3 rounded-lg border border-border bg-bg">
                    <h4 className="mb-2 font-medium text-fg">Sign the Sighash Locally</h4>
                    <p className="text-xs text-muted mb-2">Your secret key signs in the browser; only the signature is sent to the node for finalization.</p>
                    <pre className="mt-1 truncate font-mono text-[10px] text-fg">{htlcA.sighash}</pre>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => checkHtlcStatus(htlcA)} disabled={busy}>
                      <ShieldCheck className="size-3.5 mr-1" /> Check HTLC Status
                    </Button>
                    {htlcB && (
                      <Button variant="outline" size="sm" onClick={() => scrapePreimage(htlcB)} disabled={busy}>
                        <Scan className="size-3.5 mr-1" /> Scrape Preimage (from HTLC-B)
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={claimHtlcA} disabled={busy || !preimageHex}>
                      <Unlock className="size-3.5 mr-1" /> Claim (Taker, Reveal Preimage)
                    </Button>
                    <Button variant="outline" size="sm" onClick={refundHtlcA} disabled={busy}>
                      <Lock className="size-3.5 mr-1" /> Refund (Sender, after Timeout)
                    </Button>
                    {htlcStatus && (
                      <div className="flex-1 rounded-lg border border-border bg-bg p-2 text-xs">
                        <span className="text-muted">Locked:</span>{" "}
                        <span className="font-mono text-fg">{Number(htlcStatus.balance) / ATOM} KVNC</span>
                        {htlcStatus.redeem_tx && (
                          <div className="mt-1">
                            <span className="text-muted">Redeemed:</span>{" "}
                            <span className="font-mono text-teal">{htlcStatus.redeem_tx.slice(0, 16)}…</span>
                            {htlcStatus.preimage && (
                              <div className="mt-1">
                                <span className="text-muted">Preimage:</span>{" "}
                                <span className="font-mono text-teal">{htlcStatus.preimage.slice(0, 16)}…</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {state === "offer_created" && (
                <Button
                  className="w-full h-12"
                  disabled={busy}
                  onClick={fundHtlcA}
                >
                  Fund HTLC-A (Your HTLC)
                </Button>
              )}

              {htlcB && (
                <section className="rounded-xl border border-violet bg-violet/5 p-6">
                  <h2 className="mb-4 text-lg font-medium text-fg">HTLC-B (Counterparty HTLC)</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">HTLC Address</span>
                      <span className="font-mono truncate">{htlcB.htlc_address.slice(0, 16)}…</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Outpoint</span>
                      <span className="font-mono truncate">{htlcB.outpoint.tx.slice(0, 20)}…#{htlcB.outpoint.index}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Value</span>
                      <span className="font-mono">{Number(htlcB.value) / ATOM} KVNC</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Fee</span>
                      <span className="font-mono">{Number(htlcB.fee) / ATOM} KVNC</span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => checkHtlcStatus(htlcB)} disabled={busy}>
                      <ShieldCheck className="size-3.5 mr-1" /> Check HTLC Status
                    </Button>
                    {htlcA && (
                      <Button variant="outline" size="sm" onClick={() => scrapePreimage(htlcA)} disabled={busy}>
                        <Scan className="size-3.5 mr-1" /> Scrape Preimage (from HTLC-A)
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={claimHtlcB} disabled={busy || !preimageHex}>
                      <Unlock className="size-3.5 mr-1" /> Claim HTLC-B (with Preimage)
                    </Button>
                  </div>
                </section>
              )}

            </div>
          )}

          {htlcA && htlcB && state === "funding_htlc_b" && (
                <Button
                  className="w-full h-12"
                  disabled={busy}
                  onClick={fundHtlcB}
                >
                  Fund HTLC-B (Counterparty HTLC)
                </Button>
              )}

              {htlcA && htlcB && state === "funding_htlc_b" && (
                <Button
                  className="w-full h-12 bg-teal"
                  disabled={busy}
                  onClick={claimHtlcB}
                >
                  Claim HTLC-B (Taker Claims Your HTLC)
                </Button>
              )}

              {state === "completed" && (
                <div className="rounded-xl border border-teal bg-teal/5 p-6 text-center">
                  <ShieldCheck className="mx-auto size-12 text-teal" />
                  <h2 className="mt-4 text-xl font-medium text-fg">Swap Completed!</h2>
                  <p className="mt-2 text-muted">The atomic swap has been completed successfully.</p>
                  <Button className="mt-4 w-full max-w-xs" onClick={() => { setState("idle"); setOffer(null); setHtlcA(null); setHtlcB(null); }}>
                    New Swap
                  </Button>
                </div>
              )}

          {role === "taker" && state === "idle" && (
            <div className="space-y-6">
              <section className="rounded-xl border border-border bg-surface p-6">
                <h2 className="mb-4 text-lg font-medium text-fg">Take Existing Offer</h2>
                <p className="mb-4 text-sm text-muted">Paste the offer JSON shared by the maker.</p>
                <textarea
                  value={offerJson}
                  onChange={(e) => setOfferJson(e.target.value)}
                  placeholder="Paste offer JSON here..."
                  rows={10}
                  className="w-full h-48 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none resize-none"
                />
<Button className="w-full h-12 mt-4" onClick={async () => {
                  const parsed = JSON.parse(offerJson);
                  setOffer(parsed);
                  setState("offer_created");
                  toast.success("Offer loaded");
                }}>
                  Load Offer
                </Button>
              </section>
            </div>
          )}

      <ConnectHardwareModal open={showConnectModal} onOpenChange={setShowConnectModal} onConnected={(rec) => setWallet(rec)} />
    </div>
  );
}

function parseKvnc(amountKvnc: string): number | null {
  const decimal = parseFloat(amountKvnc.trim());
  if (isNaN(decimal) || decimal <= 0) return null;
  return Math.round(decimal * ATOM);
}