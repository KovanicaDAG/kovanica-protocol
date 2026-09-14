import { useState } from "react";
import { Copy, Vault, Clock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createVault,
  getVaultStatus,
  claimVault,
  parseOutpoint,
  type VaultCreateResult,
  type VaultStatus,
  type VaultLockType,
} from "@/lib/protocol/vaults";
import { parseKvnc, fmtKvnc } from "@/lib/ledger/format";
import { ATOM } from "@/lib/ledger/types";

/** KVP-105 / RFC-005 — Vaults with live API calls. */
export function VaultsView() {
  const [tab, setTab] = useState<"create" | "status" | "claim">("create");
  const [beneficiary, setBeneficiary] = useState("");
  const [amount, setAmount] = useState("1000000");
  const [lockType, setLockType] = useState<VaultLockType>("cltv");
  const [unlockAt, setUnlockAt] = useState("2000000");
  const [created, setCreated] = useState<VaultCreateResult | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [claimOut, setClaimOut] = useState("");
  const [claimDest, setClaimDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);

  async function onCreate() {
    const atoms = parseKvnc(amount);
    if (atoms === null || atoms <= 0) { toast.error("Enter a positive amount"); return; }
    const at = Number(unlockAt);
    if (!Number.isFinite(at) || at < 1) { toast.error("Unlock must be ≥ 1"); return; }
    setBusy(true);
    try {
      const res = await createVault({ beneficiaryPubkeyHex: beneficiary, amountAtoms: atoms, lockType, unlockAt: at });
      setCreated(res);
      toast.success("Vault address created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally { setBusy(false); }
  }

  async function onStatus() {
    if (!query.trim()) { toast.error("Enter address or outpoint"); return; }
    setBusy(true);
    try {
      const res = await getVaultStatus(query.trim());
      setStatus(res);
      toast.success(res.unlocked ? "Unlocked" : `${res.blocksRemaining} blocks remaining`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status failed");
    } finally { setBusy(false); }
  }

  async function onClaim() {
    setBusy(true);
    try {
      const { tx, index } = parseOutpoint(claimOut);
      const res = await claimVault({ outpointTx: tx, outpointIndex: index, destination: claimDest.trim() });
      setLastTx(res.txIdHex);
      toast.success(`Claimed · ${res.txIdHex.slice(0, 16)}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Claim failed");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-8 md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-blue uppercase">KVP-105 · RFC-005</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">Vaults</h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">CLTV / CSV time-lock vaults and treasury vesting.</p>
      <div className="mt-8 inline-flex rounded-md bg-surface-2 p-0.5">
        {([{ id: "create" as const, label: "Create", icon: Vault }, { id: "status" as const, label: "Status", icon: Clock }, { id: "claim" as const, label: "Claim", icon: Unlock }]).map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={tab === id ? "inline-flex h-9 items-center gap-1.5 rounded-sm bg-bg px-3 text-sm font-medium text-fg" : "inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium text-muted hover:text-fg"}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-border bg-surface p-5 space-y-4">
        {tab === "create" && (
          <>
            <input className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm" placeholder="Beneficiary pubkey" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
            <input className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount KVNC" />
            <select className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm" value={lockType} onChange={(e) => setLockType(e.target.value as VaultLockType)}>
              <option value="cltv">CLTV</option>
              <option value="csv">CSV</option>
            </select>
            <input type="number" className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} />
            <Button disabled={busy} onClick={() => void onCreate()}>{busy ? "…" : "Create vault"}</Button>
            {created && <p className="break-all font-mono text-xs">{created.address} · {fmtKvnc(created.amountAtoms)}</p>}
            <p className="text-xs text-subtle">POST /api/vault/create · 1 KVNC = {ATOM.toLocaleString()} atoms</p>
          </>
        )}
        {tab === "status" && (
          <>
            <input className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm" placeholder="address or txid:index" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button variant="outline" disabled={busy} onClick={() => void onStatus()}>{busy ? "…" : "Check status"}</Button>
            {status && (
              <p className="font-mono text-xs">{status.unlocked ? "UNLOCKED" : "LOCKED"} · {fmtKvnc(status.amountAtoms)} · remaining {status.blocksRemaining}</p>
            )}
          </>
        )}
        {tab === "claim" && (
          <>
            <input className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm" placeholder="txid:index" value={claimOut} onChange={(e) => setClaimOut(e.target.value)} />
            <input className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm" placeholder="Destination" value={claimDest} onChange={(e) => setClaimDest(e.target.value)} />
            <Button disabled={busy} onClick={() => void onClaim()}>{busy ? "…" : "Claim"}</Button>
            {lastTx && <p className="font-mono text-xs">{lastTx}</p>}
          </>
        )}
      </div>
    </main>
  );
}
