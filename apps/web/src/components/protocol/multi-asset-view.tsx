import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Coins, Layers, ArrowRightLeft, History, Copy, Gem, Landmark, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  NATIVE_ASSET_ID,
  fetchAddressBalances,
  fetchAddressHistory,
  prepareTransfer,
  assetPickerOptions,
  shortAssetLabel,
  type AddressBalances,
  type AddressHistory,
  type PrepareResult,
  type AssetId,
} from "@/lib/protocol/multi-asset";
import { parseKvnc, fmtKvnc } from "@/lib/ledger/format";
import { ATOM } from "@/lib/ledger/types";

type Tab = "balances" | "transfer" | "history";

/**
 * KVP-102 / RFC-002 — Native multi-asset tokens.
 * AssetPicker + per-asset prepare against live HTTP (asset_id on utxos / balances / prepare).
 */
export function MultiAssetView() {
  const [tab, setTab] = useState<Tab>("balances");
  const [address, setAddress] = useState("");
  const [balances, setBalances] = useState<AddressBalances | null>(null);
  const [history, setHistory] = useState<AddressHistory | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetId>(NATIVE_ASSET_ID);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  const [prepared, setPrepared] = useState<PrepareResult | null>(null);
  const [busy, setBusy] = useState(false);

  const picker = useMemo(() => (balances ? assetPickerOptions(balances.balances) : []), [balances]);

  async function onLoadBalances() {
    if (!address.trim()) {
      toast.error("Enter an address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchAddressBalances(address.trim());
      setBalances(res);
      const opts = assetPickerOptions(res.balances);
      if (opts.length) setSelectedAsset(opts[0].assetId);
      toast.success(
        opts.length > 1
          ? `${opts.length} assets`
          : opts[0]
            ? shortAssetLabel(opts[0].assetId)
            : "No spendable UTXOs",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLoadHistory() {
    if (!address.trim()) {
      toast.error("Enter an address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchAddressHistory(address.trim());
      setHistory(res);
      if (!balances)
        setBalances({
          address: res.address,
          balance: res.balance,
          balances: res.balances,
          utxos: [],
        });
      toast.success(`${res.txs.length} history entries`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "History failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPrepare() {
    if (!address.trim() || !to.trim()) {
      toast.error("From and to required");
      return;
    }
    const atoms = parseKvnc(amount);
    if (atoms === null || atoms <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setBusy(true);
    setPrepared(null);
    try {
      const res = await prepareTransfer({
        from: address.trim(),
        to: to.trim(),
        amount: atoms,
        assetId: selectedAsset,
      });
      setPrepared(res);
      toast.success(`Prepared · fee ${fmtKvnc(res.fee)} (${res.feeAssetId})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Prepare failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-8 md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-blue uppercase">KVP-102 · RFC-002</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">
        Multi-asset
      </h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Native multi-asset UTXOs with per-asset conservation. Balances are maps keyed by{" "}
        <code className="text-fg">asset_id</code> (native is{" "}
        <span className="font-mono text-fg">KVNC</span>). Fees are always paid in KVNC. Coin
        selection never mixes assets.
      </p>

      {/* Token tools — NFT, RWA, staking live on their own surfaces */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/wallet/rwa-issue"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Landmark className="size-3.5 text-gold" />
          Issue RWA
        </Link>
        <Link
          to="/docs"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Gem className="size-3.5 text-purple" />
          NFT (KVP-106)
        </Link>
        <Link
          to="/docs"
          hash="staking"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Lock className="size-3.5 text-teal" />
          Staking
        </Link>
      </div>

      <div className="mt-8 inline-flex rounded-md bg-surface-2 p-0.5">
        {(
          [
            { id: "balances" as const, label: "Balances", icon: Layers },
            { id: "transfer" as const, label: "Transfer", icon: ArrowRightLeft },
            { id: "history" as const, label: "History", icon: History },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
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

      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="mb-4">
          <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
            Address
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
              placeholder="Ed25519 pubkey / address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void (tab === "history" ? onLoadHistory() : onLoadBalances())}
            >
              {busy ? "…" : "Load"}
            </Button>
          </div>
        </div>

        {tab === "balances" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Prefer the <code className="text-fg">balances</code> map. Scalar{" "}
              <code className="text-fg">balance</code> remains the KVNC alias.
            </p>
            {balances && (
              <>
                <ul className="space-y-2">
                  {picker.length === 0 && (
                    <li className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted">
                      No spendable balances for this address.
                    </li>
                  )}
                  {picker.map((b) => (
                    <li
                      key={b.assetId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Coins className="size-3.5 shrink-0 text-blue" />
                        <span className="font-mono text-sm text-fg">
                          {shortAssetLabel(b.assetId, 12)}
                        </span>
                        {b.assetId === NATIVE_ASSET_ID && (
                          <span className="rounded bg-blue/15 px-1.5 py-0.5 font-mono text-[10px] text-blue uppercase">
                            native
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-sm text-fg">
                        {fmtKvnc(b.amountAtoms)}
                      </span>
                    </li>
                  ))}
                </ul>
                {balances.utxos.length > 0 && (
                  <div>
                    <p className="text-xs font-medium tracking-wide text-subtle uppercase">
                      UTXOs ({balances.utxos.length})
                    </p>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-muted">
                      {balances.utxos.map((u) => (
                        <li key={`${u.tx}:${u.index}`} className="truncate">
                          <span className="text-fg">{shortAssetLabel(u.assetId)}</span>{" "}
                          {fmtKvnc(u.value)} · {u.tx.slice(0, 12)}…:{u.index}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-subtle">
              <code className="text-fg">GET /api/utxos?address=</code> · 1 unit ={" "}
              {ATOM.toLocaleString()} atoms
            </p>
          </div>
        )}

        {tab === "transfer" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Prepare is asset-scoped. Fees always in KVNC. Omitted{" "}
              <code className="text-fg">asset_id</code> defaults to native on the node; we always
              send it explicitly.
            </p>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Asset
              </label>
              <select
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-1 focus:ring-blue"
                value={selectedAsset}
                onChange={(e) => setSelectedAsset(e.target.value)}
              >
                {picker.length === 0 && (
                  <option value={NATIVE_ASSET_ID}>KVNC (load balances first)</option>
                )}
                {picker.map((b) => (
                  <option key={b.assetId} value={b.assetId}>
                    {shortAssetLabel(b.assetId, 16)} · {fmtKvnc(b.amountAtoms)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                To
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Destination address"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Amount (display units)
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void onPrepare()}>
              {busy ? "Preparing…" : "Prepare transfer"}
            </Button>
            {prepared && (
              <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3 font-mono text-xs text-fg">
                <p>
                  Fee {fmtKvnc(prepared.fee)}{" "}
                  <span className="text-muted">({prepared.feeAssetId})</span>
                </p>
                <p className="text-muted">
                  Inputs {prepared.inputs.length} · Outputs {prepared.outputs.length}
                  {prepared.change ? ` · change ${fmtKvnc(prepared.change.value)}` : ""}
                </p>
                <p className="break-all text-muted">sighash {prepared.sighash.slice(0, 24)}…</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(prepared.sighash)
                      .then(() => toast.success("Sighash copied"))
                  }
                >
                  <Copy className="size-3.5" /> Copy sighash
                </Button>
              </div>
            )}
            <p className="text-xs text-subtle">
              <code className="text-fg">POST /api/prepare</code> with{" "}
              <code className="text-fg">asset_id</code>
            </p>
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Each history delta carries <code className="text-fg">asset_id</code>.
            </p>
            {history && (
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {history.txs.length === 0 && (
                  <li className="text-sm text-muted">No history entries.</li>
                )}
                {history.txs.map((t, i) => (
                  <li
                    key={`${t.tx}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="min-w-0 truncate text-muted">
                      <span className="text-fg">{shortAssetLabel(t.assetId)}</span> {t.kind ?? "tx"}{" "}
                      · {t.tx.slice(0, 12)}…
                    </span>
                    <span className={t.delta >= 0 ? "shrink-0 text-ok" : "shrink-0 text-danger"}>
                      {t.delta >= 0 ? "+" : ""}
                      {fmtKvnc(t.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-subtle">
              <code className="text-fg">GET /api/history?address=</code>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
