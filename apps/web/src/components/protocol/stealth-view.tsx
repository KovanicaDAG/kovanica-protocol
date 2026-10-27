import { useState } from "react";
import { Eye, KeyRound, Scan } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createStealthMeta,
  deriveOnetimeAddress,
  scanStealthOutputs,
  prepareStealthSpend,
  submitStealthSpend,
  type StealthMetaAddress,
  type StealthOnetime,
  type StealthScanHit,
} from "@/lib/protocol/stealth";
import { signSighashWithSeedHex } from "@/lib/wallet/keys";
import { parseKvnc, fmtKvnc } from "@/lib/ledger/format";

/** KVP-103 / RFC-003 — Stealth; spends sign with one-time seed only. */
export function StealthView() {
  const [tab, setTab] = useState<"receive" | "scan" | "spend">("receive");
  const [scanPubkey, setScanPubkey] = useState("");
  const [spendPubkey, setSpendPubkey] = useState("");
  const [viewTag, setViewTag] = useState("");
  const [meta, setMeta] = useState<StealthMetaAddress | null>(null);
  const [onetime, setOnetime] = useState<StealthOnetime | null>(null);
  const [scanPriv, setScanPriv] = useState("");
  const [hits, setHits] = useState<StealthScanHit[]>([]);
  const [spendFrom, setSpendFrom] = useState("");
  const [spendTo, setSpendTo] = useState("");
  const [spendAmount, setSpendAmount] = useState("1");
  const [oneTimeSeed, setOneTimeSeed] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreateMeta() {
    setBusy(true);
    try {
      const res = await createStealthMeta(scanPubkey, spendPubkey || scanPubkey, viewTag || undefined);
      setMeta(res);
      toast.success("Stealth meta-address created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDerive() {
    if (!meta) {
      toast.error("Create a meta-address first");
      return;
    }
    setBusy(true);
    try {
      const res = await deriveOnetimeAddress(meta.metaAddress);
      setOnetime(res);
      toast.success("One-time address derived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Derive failed");
    } finally {
      setBusy(false);
    }
  }

  async function onScan() {
    setBusy(true);
    try {
      // scanPriv is never sent to the network — library enforces client-side only
      const res = await scanStealthOutputs(scanPriv, viewTag || undefined);
      setHits(res);
      toast.success(res.length ? `Found ${res.length} output(s)` : "No matching outputs");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
      setScanPriv("");
    }
  }

  async function onSpend() {
    const atoms = parseKvnc(spendAmount);
    if (atoms === null || atoms <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    if (!spendFrom.trim() || !spendTo.trim()) {
      toast.error("From and to required");
      return;
    }
    const seed = oneTimeSeed.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(seed)) {
      toast.error("One-time private seed (64 hex) is required — not the wallet mnemonic");
      return;
    }
    setBusy(true);
    try {
      const prep = await prepareStealthSpend(spendFrom.trim(), spendTo.trim(), atoms);
      const sig = await signSighashWithSeedHex(seed, prep.sighash);
      const sub = await submitStealthSpend(spendFrom.trim(), spendTo.trim(), atoms, sig);
      toast.success(`Submitted · ${sub.tx.slice(0, 16)}…`);
      setOneTimeSeed("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Spend failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-8 md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-blue uppercase">KVP-103 · RFC-003</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">Stealth</h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        One-time ECDH addresses. Scan keys never leave the browser. Spends require the one-time seed.
      </p>
      <div className="mt-8 inline-flex rounded-md bg-surface-2 p-0.5">
        {([
          { id: "receive" as const, label: "Receive", icon: KeyRound },
          { id: "scan" as const, label: "Scan", icon: Scan },
          { id: "spend" as const, label: "Spend", icon: Eye },
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
        {tab === "receive" && (
          <>
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Scan pubkey 64 hex"
              value={scanPubkey}
              onChange={(e) => setScanPubkey(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Spend pubkey (optional)"
              value={spendPubkey}
              onChange={(e) => setSpendPubkey(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="View tag"
              value={viewTag}
              onChange={(e) => setViewTag(e.target.value)}
            />
            <Button disabled={busy} onClick={() => void onCreateMeta()}>
              {busy ? "…" : "Create meta-address"}
            </Button>
            {meta && (
              <div className="rounded-lg border border-gold/30 bg-gold/5 p-3">
                <p className="break-all font-mono text-xs">{meta.metaAddress}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void onDerive()}>
                  Derive one-time
                </Button>
                {onetime && <p className="mt-1 font-mono text-xs text-muted">{onetime.address}</p>}
              </div>
            )}
          </>
        )}
        {tab === "scan" && (
          <>
            <p className="text-sm text-muted">
              The scan private key is never uploaded. Full ECDH scan runs offline / on a local node.
            </p>
            <input
              type="password"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Scan privkey (local only — not sent)"
              value={scanPriv}
              onChange={(e) => setScanPriv(e.target.value)}
            />
            <Button disabled={busy} onClick={() => void onScan()}>
              {busy ? "…" : "Scan (client-side)"}
            </Button>
            {hits.map((h, i) => (
              <p key={i} className="font-mono text-xs">
                {h.outpoint.tx.slice(0, 12)}…:{h.outpoint.index} · {fmtKvnc(h.value)}
              </p>
            ))}
          </>
        )}
        {tab === "spend" && (
          <>
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="From one-time address"
              value={spendFrom}
              onChange={(e) => setSpendFrom(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="Destination"
              value={spendTo}
              onChange={(e) => setSpendTo(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              value={spendAmount}
              onChange={(e) => setSpendAmount(e.target.value)}
            />
            <input
              type="password"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
              placeholder="One-time private seed (64 hex) — required"
              value={oneTimeSeed}
              onChange={(e) => setOneTimeSeed(e.target.value)}
            />
            <Button disabled={busy} onClick={() => void onSpend()}>
              {busy ? "…" : "Prepare & sign with one-time key"}
            </Button>
            <p className="text-xs text-subtle">Signs with the one-time seed, not the wallet mnemonic.</p>
          </>
        )}
      </div>
    </main>
  );
}
