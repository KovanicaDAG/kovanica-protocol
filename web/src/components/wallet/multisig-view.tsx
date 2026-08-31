import { useMemo, useState } from "react";
import { Copy, Plus, Trash2, Users, ShieldCheck, Send, Combine, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseAddr } from "@/lib/wallet/address";
import { fmtKvnc, parseKvnc } from "@/lib/ledger/format";
import { useHydrated } from "@/lib/use-hydrated";
import {
  type MultisigAddressResult,
  type MultisigOutput,
  type MultisigSpendProposal,
  buildMultisigSpend,
  combineMultisigSigs,
  createMultisigAddress,
  signMultisigPartial,
  submitMultisigTx,
} from "@/lib/wallet/multisig";

type Tab = "create" | "spend" | "combine";
type SavedMultisig = MultisigAddressResult & { savedAt: number };

const STORAGE_KEY = "kovanica.multisig.addresses";

function loadSaved(): SavedMultisig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedMultisig[]) : [];
  } catch {
    return [];
  }
}

function saveSaved(items: SavedMultisig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function MultisigView() {
  const hydrated = useHydrated();
  const [tab, setTab] = useState<Tab>("create");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header>
        <p className="font-mono text-[10px] tracking-brand text-gold uppercase">KVNC</p>
        <h1 className="font-display text-3xl tracking-tight text-fg">Multisig</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          M-of-N shared custody. Create a P2SH address, propose spends, and collect partial
          signatures before submitting.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface p-1.5">
        {([
          { id: "create", label: "Create", icon: Users },
          { id: "spend", label: "Spend", icon: Send },
          { id: "combine", label: "Combine", icon: Combine },
        ] as const).map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150",
                on ? "bg-surface-2 text-gold shadow-border" : "text-muted hover:text-fg",
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "create" && <CreatePanel />}
      {tab === "spend" && <SpendPanel />}
      {tab === "combine" && <CombinePanel />}

      {!hydrated && (
        <p className="text-center text-xs text-muted">Loading local multisig data…</p>
      )}
    </div>
  );
}

function CreatePanel() {
  const [threshold, setThreshold] = useState(2);
  const [pubkeys, setPubkeys] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MultisigAddressResult | null>(null);
  const [saved, setSaved] = useState<SavedMultisig[]>(() => loadSaved());

  function setN(n: number) {
    if (n < 1 || n > 16) return;
    setPubkeys((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
    if (threshold > n) setThreshold(n);
  }

  async function onCreate() {
    setBusy(true);
    try {
      const res = await createMultisigAddress(threshold, pubkeys);
      setResult(res);
      toast.success(`Created ${threshold}-of-${res.pubkeys.length} multisig`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create multisig");
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    if (!result) return;
    const item: SavedMultisig = { ...result, savedAt: Date.now() };
    const next = [item, ...saved.filter((s) => s.address !== result.address)].slice(0, 20);
    setSaved(next);
    saveSaved(next);
    toast.success("Saved to this browser");
  }

  function onDelete(addr: string) {
    const next = saved.filter((s) => s.address !== addr);
    setSaved(next);
    saveSaved(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Threshold</p>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={pubkeys.length}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-surface-2 accent-gold"
          />
          <span className="w-16 rounded-md bg-surface-2 py-2 text-center font-mono text-sm text-fg">
            {threshold}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">
          At least {threshold} cosigner signatures are required to spend.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] tracking-wide text-subtle uppercase">Cosigner public keys</p>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setN(pubkeys.length - 1)} disabled={pubkeys.length <= 2}>
              −
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setN(pubkeys.length + 1)} disabled={pubkeys.length >= 16}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {pubkeys.map((pk, i) => (
            <input
              key={i}
              value={pk}
              onChange={(e) => {
                const next = [...pubkeys];
                next[i] = e.target.value;
                setPubkeys(next);
              }}
              placeholder={`Cosigner ${i + 1} Ed25519 pubkey (64 hex)`}
              className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
            />
          ))}
        </div>
        <Button type="button" className="mt-4 h-12 w-full bg-gold text-black hover:bg-gold/90" disabled={busy} onClick={() => void onCreate()}>
          {busy ? "Building…" : "Create multisig address"}
        </Button>
      </section>

      {result && (
        <section className="rounded-xl border border-gold/30 bg-gold/5 p-4">
          <div className="flex items-center gap-2 text-gold">
            <ShieldCheck className="size-4" />
            <p className="text-xs font-medium uppercase tracking-wide">{result.threshold}-of-{result.pubkeys.length} address</p>
          </div>
          <p className="mt-2 break-all font-mono text-sm text-fg">{result.address}</p>
          <p className="mt-1 break-all font-mono text-[11px] text-subtle">Redeem script: {result.redeemScriptHex}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(result.address).then(() => toast.success("Address copied"))}>
              <Copy className="size-3.5" />
              Copy address
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onSave}>
              <Save className="size-3.5" />
              Save
            </Button>
          </div>
        </section>
      )}

      {saved.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">Saved addresses</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {saved.map((s) => (
              <li key={s.address} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-fg">{s.address}</p>
                  <p className="text-[11px] text-muted">{s.threshold}-of-{s.pubkeys.length}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Delete" onClick={() => onDelete(s.address)}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SpendPanel() {
  const saved = useMemo(() => loadSaved(), []);
  const [from, setFrom] = useState(saved[0]?.address ?? "");
  const [outputs, setOutputs] = useState<MultisigOutput[]>([{ to: "", atoms: 0 }]);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<MultisigSpendProposal | null>(null);

  async function onBuild() {
    const clean = outputs
      .map((o) => ({ to: o.to.trim(), atoms: o.atoms }))
      .filter((o) => o.to && o.atoms > 0);
    if (clean.length === 0) {
      toast.error("Add at least one valid output");
      return;
    }
    if (!parseAddr(from)) {
      toast.error("From address is not valid");
      return;
    }
    setBusy(true);
    try {
      const p = await buildMultisigSpend(from, clean);
      setProposal(p);
      toast.success("Spend proposal built");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build spend");
    } finally {
      setBusy(false);
    }
  }

  function setAmount(i: number, raw: string) {
    const atoms = parseKvnc(raw) ?? 0;
    setOutputs((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], atoms };
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">From multisig address</p>
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
        >
          <option value="">Paste or select a saved address</option>
          {saved.map((s) => (
            <option key={s.address} value={s.address}>
              {s.threshold}-of-{s.pubkeys.length} · {s.address.slice(0, 18)}…
            </option>
          ))}
        </select>
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="kvnc…dag"
          className="mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Outputs</p>
        <div className="mt-3 flex flex-col gap-3">
          {outputs.map((o, i) => (
            <div key={i} className="flex flex-col gap-2 sm:flex-row">
              <input
                value={o.to}
                onChange={(e) => {
                  const next = [...outputs];
                  next[i] = { ...next[i], to: e.target.value };
                  setOutputs(next);
                }}
                placeholder="kvnc…dag"
                className="h-11 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
              />
              <div className="flex gap-2">
                <input
                  value={o.atoms > 0 ? fmtKvnc(o.atoms) : ""}
                  onChange={(e) => setAmount(i, e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  className="h-11 w-32 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={outputs.length <= 1}
                  onClick={() => setOutputs((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => setOutputs((prev) => [...prev, { to: "", atoms: 0 }])}
        >
          <Plus className="size-3.5" />
          Add output
        </Button>
      </section>

      <Button type="button" className="h-12 bg-teal text-black hover:bg-teal/90" disabled={busy} onClick={() => void onBuild()}>
        {busy ? "Building…" : "Build spend proposal"}
      </Button>

      {proposal && (
        <section className="rounded-xl border border-teal/30 bg-teal/5 p-4">
          <p className="text-[10px] tracking-wide text-teal uppercase">Proposal</p>
          <p className="mt-1 break-all font-mono text-xs text-fg">Sighash: {proposal.sighashHex}</p>
          <p className="mt-2 text-xs text-muted">
            Share this sighash with the required number of cosigners. Each cosigner signs it with
            their own seed, then the signatures are combined on the Combine tab.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() =>
              void navigator.clipboard.writeText(JSON.stringify(proposal, null, 2)).then(() =>
                toast.success("Proposal copied"),
              )
            }
          >
            <Copy className="size-3.5" />
            Copy proposal JSON
          </Button>
        </section>
      )}
    </div>
  );
}

function CombinePanel() {
  const [proposalText, setProposalText] = useState("");
  const [sigs, setSigs] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tx: string } | null>(null);

  const proposal: MultisigSpendProposal | null = useMemo(() => {
    try {
      return JSON.parse(proposalText) as MultisigSpendProposal;
    } catch {
      return null;
    }
  }, [proposalText]);

  async function onCombine() {
    if (!proposal) {
      toast.error("Paste a valid proposal JSON");
      return;
    }
    const clean = sigs.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) {
      toast.error("Add at least one signature");
      return;
    }
    setBusy(true);
    try {
      const tx = await combineMultisigSigs(proposal, clean);
      const submitted = await submitMultisigTx(tx);
      setResult(submitted);
      toast.success("Multisig transaction submitted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Combine/submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Proposal JSON</p>
        <textarea
          value={proposalText}
          onChange={(e) => setProposalText(e.target.value)}
          placeholder='{"sighashHex":"...","txBlobHex":"...","from":"...","outputs":[...]}'
          rows={5}
          className="mt-2 min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Partial signatures (hex)</p>
        <div className="mt-3 flex flex-col gap-2">
          {sigs.map((sig, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={sig}
                onChange={(e) => {
                  const next = [...sigs];
                  next[i] = e.target.value;
                  setSigs(next);
                }}
                placeholder={`Signature ${i + 1}`}
                className="h-11 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
              />
              <Button type="button" variant="ghost" size="icon" disabled={sigs.length <= 1} onClick={() => setSigs((prev) => prev.filter((_, idx) => idx !== i))}>
                <Trash2 className="size-4 text-danger" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setSigs((prev) => [...prev, ""])}>
          <Plus className="size-3.5" />
          Add signature
        </Button>
      </section>

      <Button type="button" className="h-12 bg-gold text-black hover:bg-gold/90" disabled={busy || !proposal} onClick={() => void onCombine()}>
        {busy ? "Combining…" : "Combine & submit"}
      </Button>

      {result && (
        <section className="rounded-xl border border-ok/30 bg-ok/5 p-4">
          <p className="text-[10px] tracking-wide text-ok uppercase">Submitted</p>
          <p className="mt-1 break-all font-mono text-xs text-fg">Tx: {result.tx || "pending"}</p>
        </section>
      )}

      <SignLocallyCard />
    </div>
  );
}

/** Helper for a cosigner who has this wallet unlocked to sign a sighash locally. */
function SignLocallyCard() {
  const [txBlob, setTxBlob] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSign() {
    if (!txBlob || !mnemonic) {
      toast.error("Enter transaction blob and seed");
      return;
    }
    setBusy(true);
    try {
      const s = await signMultisigPartial(mnemonic, 0, txBlob);
      setSig(s);
      toast.success("Partial signature created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setBusy(false);
      setMnemonic("");
    }
  }

  return (
    <section className="rounded-xl border border-dashed border-border bg-surface/50 p-4">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Cosigner tool: sign locally</p>
      <p className="mt-1 text-xs text-muted">
        Paste a transaction blob and your seed to produce a partial signature. The seed stays in this
        browser and is cleared after signing.
      </p>
      <input
        value={txBlob}
        onChange={(e) => setTxBlob(e.target.value)}
        placeholder="Sighash (64 hex)"
        className="mt-3 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
      />
      <input
        type="password"
        value={mnemonic}
        onChange={(e) => setMnemonic(e.target.value)}
        placeholder="BIP39 seed phrase"
        className="mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
      />
      <Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => void onSign()}>
        {busy ? "Signing…" : "Sign"}
      </Button>
      {sig && (
        <div className="mt-3 rounded-md bg-surface-2 p-3">
          <p className="break-all font-mono text-[11px] text-fg">{sig}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => void navigator.clipboard.writeText(sig).then(() => toast.success("Signature copied"))}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      )}
    </section>
  );
}
