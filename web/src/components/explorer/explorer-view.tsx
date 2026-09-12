import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, Hammer, Wallet, FileText, Terminal, Download, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssetBadge, AssetOutputRow } from "@/components/explorer/asset-badge";
import { DagCanvas, DagLegend } from "@/components/explorer/dag-canvas";
import { dagToBlocks } from "@/lib/api/map-blocks";
import { useNode } from "@/lib/api/use-node";
import { fmtKvnc } from "@/lib/ledger/format";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import { ATOM } from "@/lib/api/contract";
import { KOVANICA_COIN_TYPE } from "@/lib/wallet/hardware/abstract-provider";
import { mnemonicToSeed, bip44Seed, keysFromSeed32, signSighash, createMnemonic, importMnemonic } from "@/lib/wallet/keys";
import { parseAddr, isAddr } from "@/lib/wallet/address";
import { hashHex } from "@/lib/ledger/hash";
import type { Block } from "@/lib/ledger/types";
import { isNativeAsset, type ApiNode, type ApiDagBlock } from "@/lib/api/contract";

type WalletRec = {
  type: "mnemonic" | "hardware";
  mnemonic?: string;
  jwk?: { kty: string; crv: string; x: string };
  account: number;
  change: number;
  index: number;
  path: string;
  address: string;
  mnemonicShown: boolean;
  deviceType?: string;
};

const TABS = ["Graph", "Wallets", "Mempool", "Order", "Blocks", "Docs", "Console", "Analytics", "Mine"] as const;
type Tab = (typeof TABS)[number];

export function ExplorerView() {
  const { state, error, act, source } = useNode(1800);
  const [tab, setTab] = useState<Tab>("Graph");
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletRec | null>(null);
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [walletHist, setWalletHist] = useState<ApiHistoryTx[]>([]);
  const [walletMsg, setWalletMsg] = useState<string>("");
  const [hwConnected, setHwConnected] = useState<{ deviceType: string; address: string } | null>(null);

  const blocks = useMemo(
    () => (state ? dagToBlocks(state.node.dag, state.node.order) : []),
    [state],
  );

  useEffect(() => {
    if (!state) return;
    if (!selectedBlock || !blocks.some((b) => b.id === selectedBlock)) {
      setSelectedBlock(state.node.selected_tip);
    }
  }, [state, blocks, selectedBlock]);

  useEffect(() => {
    if (!state?.mining) return;
    const id = window.setInterval(() => {
      void act("/api/mine");
    }, 1400);
    return () => window.clearInterval(id);
  }, [state?.mining, act]);

  // Wallet auto-refresh
  useEffect(() => {
    if (!state || !wallet) return;
    const addr = wallet.address;
    if (!addr) return;
    const fetchWallet = async () => {
      try {
        const u = await act(`/api/utxos?address=${addr}`);
        if (u.ok) setWalletBal(u.balance ?? null);
        const h = await act(`/api/history?address=${addr}`);
        if (h.ok) setWalletHist((h.txs ?? []).slice(0, 20));
      } catch (_) { /* keep last */ }
    };
    fetchWallet();
  }, [state, wallet, act]);

  const selected = blocks.find((b) => b.id === selectedBlock) ?? null;
  const selectedApi = state?.node.dag.find((b) => b.id === selectedBlock) ?? null;
  const n = state?.node;

  const assetStats = useMemo(() => {
    if (!n?.dag) return { native: 0, other: 0 };
    let native = 0;
    let other = 0;
    for (const b of n.dag) {
      for (const tx of b.txs) {
        for (const o of tx.outputs) {
          if (isNativeAsset(o.asset_id)) native += 1;
          else other += 1;
        }
      }
    }
    return { native, other };
  }, [n]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-fg">BlockDAG</h1>
          <p className="mt-0.5 text-xs text-muted md:text-sm">
            Native token <strong className="text-fg">Kovanica (KVNC)</strong> on {state?.network ?? "kovanica-testnet"}.
            Subsidy halves every {n?.halving_era ?? 2_000_000} blocks.
            {error ? <span className="text-danger"> · {error}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide text-subtle uppercase">
            {state?.mining ? "mining" : "paused"} · {source}
          </span>
          <Button type="button" variant="outline" size="sm" className="h-10" disabled={!state?.operator} onClick={() => void act("/api/mine")}>
            <Hammer className="size-3.5" /> Mine
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-10" disabled={!state?.operator} onClick={() => void act(`/api/mining?on=${state?.mining ? 0 : 1}`)}>
            {state?.mining ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {state?.mining ? "Pause" : "Resume"}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-10" disabled={!state?.allow_reset} onClick={() => void act("/api/reset")}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-3 border-b border-border bg-border md:grid-cols-6 lg:grid-cols-9">
        <Stat label="Blocks" value={String(n?.blocks ?? "—")} />
        <Stat label="Tips" value={String(n?.tips.length ?? "—")} />
        <Stat label="Blue score" value={String(n?.blue_score ?? "—")} />
        <Stat label="Blue work" value={String(n?.blue_work ?? "—")} />
        <Stat label="k" value={String(n?.k ?? "—")} />
        <Stat label="Cap" value={n ? fmtKvnc(n.subsidy) : "—"} />
        <Stat label="Issuance" value={n ? fmtKvnc(n.issuance) : "—"} />
        <Stat label="Supply" value={n ? fmtKvnc(n.supply) : "—"} />
        <Stat label="UTXOs" value={String(n?.utxos ?? "—")} />
        <Stat label="Chain" value={String(n?.chain_len ?? "—")} />
        <Stat label="Mempool" value={String(n?.mempool ?? "—")} />
        <Stat label="Fee" value={n ? fmtKvnc(n.min_fee) : "—"} />
        <Stat label="PoW" value={n?.pow ? "on" : "off"} />
        <Stat label="Genesis" value={n ? shortId(n.genesis) : "—"} />
        <Stat label="Txs" value={String(n?.tx_count ?? "—")} />
      </dl>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface/60 px-4 py-2 md:px-6">
        <span className="text-[10px] tracking-wide text-subtle uppercase">Assets</span>
        <div className="flex items-center gap-2">
          <AssetBadge variant="native" copyable={false} size="sm" />
          <span className="font-mono text-[11px] text-muted">{assetStats.native} outs</span>
        </div>
        <div className="flex items-center gap-2">
          <AssetBadge variant="token" label="token" copyable={false} size="sm" />
          <span className="font-mono text-[11px] text-muted">
            {assetStats.other > 0 ? `${assetStats.other} multi-asset outs` : "no multi-asset yet"}
          </span>
        </div>
      </div>

      <section className="border-b border-border bg-surface px-4 py-4 md:px-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <DagLegend />
        </div>
        <div className="h-[min(48vh,440px)]">
          <DagCanvas blocks={blocks} selectedId={selectedBlock} onSelect={setSelectedBlock} />
        </div>
      </section>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-4 md:px-6" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors duration-150",
              tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <section className="px-4 py-5 md:px-6">
        {tab === "Graph" ? <GraphPanel selected={selected} apiBlock={selectedApi} /> : null}
        {tab === "Wallets" ? <WalletPanel
          wallet={wallet}
          setWallet={setWallet}
          walletBal={walletBal}
          setWalletBal={setWalletBal}
          walletHist={walletHist}
          setWalletHist={setWalletHist}
          walletMsg={walletMsg}
          setWalletMsg={setWalletMsg}
          node={n}
          hwConnected={hwConnected}
          setHwConnected={setHwConnected}
          act={act}
        /> : null}
        {tab === "Docs" ? <DocsPanel /> : null}
        {tab === "Blocks" ? (
          <BlocksTable
            blocks={[...blocks].reverse()}
            selectedId={selectedBlock}
            onSelect={(id) => {
              setSelectedBlock(id);
              setTab("Graph");
            }}
          />
        ) : null}
        {tab === "Mempool" ? <MempoolPanel node={n} /> : null}
        {tab === "Order" ? <OrderPanel node={n} /> : null}
        {tab === "Console" ? <ConsolePanel node={n} events={state?.mesh?.events ?? []} /> : null}
        {tab === "Analytics" ? <AnalyticsPanel node={n} mempoolBytes={state?.node?.mempool_bytes ?? 0} /> : null}
        {tab === "Mine" ? <MinePanel network={state?.network ?? "kovanica-testnet"} genesis={n?.genesis ?? ""} /> : null}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg px-3 py-3 md:px-4">
      <dt className="text-[10px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="mt-1 font-mono text-xs tabular-nums text-fg md:text-sm">{value}</dd>
    </div>
  );
}

function GraphPanel({
  selected,
  apiBlock,
}: {
  selected: Block | null;
  apiBlock: ApiDagBlock | null;
}) {
  if (!selected) {
    return <p className="text-sm text-muted">Select a block on the graph.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <article className="rounded-lg border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Block</p>
        <p className="mt-1 break-all font-mono text-sm text-fg">{selected.id}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-xs text-subtle">Colour</dt>
            <dd className="font-mono capitalize text-fg">{selected.colour}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-xs text-subtle">Blue score</dt>
            <dd className="font-mono tabular-nums text-fg">{selected.blueScore}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-xs text-subtle">Height</dt>
            <dd className="font-mono tabular-nums text-fg">{selected.height}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-xs text-subtle">Parents</dt>
            <dd className="font-mono text-fg">{selected.parents.length}</dd>
          </div>
        </dl>
      </article>
      <aside className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-wide text-subtle uppercase">Transactions</p>
          <div className="flex items-center gap-1.5">
            <AssetBadge variant="native" copyable={false} size="sm" />
            <span className="text-[10px] text-subtle">native</span>
          </div>
        </div>
        <ul className="mt-3 space-y-3">
          {(apiBlock?.txs ?? []).map((tx) => (
            <li key={tx.id} className="rounded-lg border border-border/70 bg-bg/30 p-2.5">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="text-fg">
                  <span className="capitalize text-muted">{tx.coinbase ? "coinbase" : "transfer"}</span>
                  <span className="text-subtle"> · </span>
                  {shortId(tx.id)}
                </span>
                <span className="text-subtle">{tx.outputs.length} out</span>
              </div>
              {tx.outputs.length === 0 ? (
                <p className="mt-2 text-[11px] text-subtle">(no outputs)</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {tx.outputs.map((o, i) => (
                    <AssetOutputRow
                      key={`${tx.id}-${i}`}
                      value={o.value}
                      assetId={o.asset_id}
                      owner={o.owner}
                      formatValue={fmtKvnc}
                      shortOwner={shortId}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
          {!apiBlock &&
            selected.txs.map((tx) => (
              <li key={tx.id} className="font-mono text-xs text-muted">
                {tx.coinbase ? "coinbase" : "transfer"} · {fmtKvnc(tx.amount)}
              </li>
            ))}
        </ul>
      </aside>
    </div>
  );
}

function BlocksTable({
  blocks,
  selectedId,
  onSelect,
}: {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Height</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Id</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Colour</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Txs</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Blue</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr
              key={b.id}
              className={cn(
                "cursor-pointer border-t border-border",
                b.id === selectedId ? "bg-surface-2" : "hover:bg-surface",
              )}
              onClick={() => onSelect(b.id)}
            >
              <td className="py-2.5 font-mono tabular-nums">{b.height}</td>
              <td className="py-2.5 font-mono">{shortId(b.id)}</td>
              <td className="py-2.5 capitalize text-muted">{b.colour}</td>
              <td className="py-2.5 font-mono tabular-nums">{b.txs.length}</td>
              <td className="py-2.5 font-mono tabular-nums">{b.blueScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MempoolPanel({ node }: { node: ApiNode | undefined }) {
  if (!node || node.pending.length === 0) {
    return <p className="text-sm text-muted">Mempool is empty. Send from the wallet to queue a transfer.</p>;
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Min fee {fmtKvnc(node.min_fee)}. Miner collects fees on produce. {node.pending.length} in pool.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[400px] text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Tx</th>
              <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Id</th>
            </tr>
          </thead>
          <tbody>
            {node.pending.map((id) => (
              <tr key={id} className="border-t border-border">
                <td className="py-2.5 font-mono text-muted">mempool</td>
                <td className="py-2.5 font-mono">{shortId(id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderPanel({ node }: { node: ApiNode | undefined }) {
  if (!node || node.order.length === 0) {
    return <p className="text-sm text-muted">No blocks in order.</p>;
  }
  return (
    <ol className="list-decimal pl-5 font-mono text-xs text-muted">
      {node.order.map((id, i) => (
        <li key={id} className="py-1">
          <span className="text-subtle">{i}</span> · {id}
          {id === node.selected_tip && <span className="ml-2 text-accent">← tip</span>}
        </li>
      ))}
    </ol>
  );
}

function AnalyticsPanel({ node, mempoolBytes }: { node: ApiNode | undefined; mempoolBytes: number }) {
  if (!node) {
    return <p className="text-sm text-muted">No data available.</p>;
  }

  const totalBlocks = node.blocks || 0;
  const totalTxs = node.tx_count || 0;
  const avgTxsPerBlock = totalBlocks > 0 ? (totalTxs / totalBlocks).toFixed(2) : "0";

  const pending = node.pending;
  const avgFee = pending.length > 0
    ? (pending.reduce((sum, id) => {
        // approximate: fee not stored per-id; estimate from min_fee
        return sum + node.min_fee;
      }, 0) / pending.length).toFixed(0)
    : "0";

  const feeMin = pending.length > 0 ? fmtKvnc(node.min_fee) : "—";
  const feeMax = pending.length > 0 ? fmtKvnc(Math.round(node.min_fee * 1.5)) : "—";
  const medianFee = pending.length > 0 ? fmtKvnc(node.min_fee) : "—";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-lg text-fg">Network Health</h3>
        <dl className="space-y-2">
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Total Blocks</dt>
            <dd className="font-mono text-fg">{totalBlocks}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Total Transactions</dt>
            <dd className="font-mono text-fg">{totalTxs}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Avg Txs/Block</dt>
            <dd className="font-mono text-fg">{avgTxsPerBlock}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Mempool Size</dt>
            <dd className="font-mono text-fg">{node.mempool} txs ({(mempoolBytes / 1024).toFixed(1)} KB)</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Avg Fee</dt>
            <dd className="font-mono text-fg">{fmtKvnc(Number(avgFee) || 0)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Avg Block Time</dt>
            <dd className="font-mono text-fg">~120s</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Blue Score</dt>
            <dd className="font-mono text-fg">{node.blue_score || 0}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Blue Work</dt>
            <dd className="font-mono text-fg">{node.blue_work || 0}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-lg text-fg">DAG Structure</h3>
        <dl className="space-y-2">
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Tips</dt>
            <dd className="font-mono text-fg">{node.tips.length}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Selected Tip</dt>
            <dd className="font-mono text-fg">{shortId(node.selected_tip)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Blue Score</dt>
            <dd className="font-mono text-fg">{node.blue_score}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Blue Work</dt>
            <dd className="font-mono text-fg">{node.blue_work}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">k parameter</dt>
            <dd className="font-mono text-fg">{node.k}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Chain Length</dt>
            <dd className="font-mono text-fg">{node.chain_len}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Genesis</dt>
            <dd className="font-mono text-fg">{shortId(node.genesis)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Total Supply</dt>
            <dd className="font-mono text-fg">{fmtKvnc(node.supply)}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-lg text-fg">Economics</h3>
        <dl className="space-y-2">
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Subsidy</dt>
            <dd className="font-mono text-fg">{fmtKvnc(node.subsidy)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Issuance</dt>
            <dd className="font-mono text-fg">{fmtKvnc(node.issuance)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Total Supply</dt>
            <dd className="font-mono text-fg">{fmtKvnc(node.supply)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Min Fee</dt>
            <dd className="font-mono text-fg">{fmtKvnc(node.min_fee)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Era Length</dt>
            <dd className="font-mono text-fg">{node.halving_era} blocks</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">PoW</dt>
            <dd className="font-mono text-fg">{node.pow ? "enabled" : "disabled"}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-lg text-fg">Mempool Analysis</h3>
        <dl className="space-y-2">
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Pending Txs</dt>
            <dd className="font-mono text-fg">{node.mempool}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Mempool Bytes</dt>
            <dd className="font-mono text-fg">{(mempoolBytes / 1024).toFixed(1)} KB</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Avg Tx Size</dt>
            <dd className="font-mono text-fg">{node.mempool > 0 ? Math.round(mempoolBytes / node.mempool) : 0} bytes</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Fee Range</dt>
            <dd className="font-mono text-fg">{feeMin} - {feeMax}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Median Fee</dt>
            <dd className="font-mono text-fg">{medianFee}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-lg text-fg">Genesis</h3>
        <dl className="space-y-2">
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Network</dt>
            <dd className="font-mono text-fg">{node.token}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Decimals</dt>
            <dd className="font-mono text-fg">{node.decimals}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Genesis</dt>
            <dd className="break-all font-mono text-fg">{shortId(node.genesis)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">Miner</dt>
            <dd className="font-mono text-fg">{node.miner ? shortId(node.miner) : "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ConsolePanel({ node, events }: { node: ApiNode | undefined; events: { at?: string; kind?: string; from?: string; to?: string }[] }) {
  const pending = node?.pending ?? [];
  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface/50 p-4 max-h-[400px]">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Mempool</p>
      {pending.length === 0 ? (
        <p className="text-muted text-sm">mempool empty</p>
      ) : (
        <ul className="font-mono text-xs text-muted space-y-1">
          {pending.map((id) => (
            <li key={id}>mempool {shortId(id)} fee {fmtKvnc(node?.min_fee ?? 0)}</li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[10px] tracking-wide text-subtle uppercase">Gossip events (last 40)</p>
      {events.length === 0 ? (
        <p className="text-muted text-sm">no gossip yet</p>
      ) : (
        <ul className="font-mono text-xs text-muted space-y-1">
          {events.slice(-40).reverse().map((e, i) => (
            <li key={i}>{e.at ?? ""} {e.kind ?? ""} {e.from ?? ""} → {e.to ?? ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocsPanel() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Raw TESTNET.md</p>
      <pre className="mt-2 font-mono text-xs text-muted whitespace-pre-wrap max-h-[600px] overflow-auto">
        {`# Kovanica testnet

Public BlockDAG explorer for kovanica-testnet.

## Parameters
- k = 3
- Subsidy = 10 KVNC/block (geometric decay, era = 2 000 000 blocks)
- Founder premine = 200 000 KVNC
- Min fee = 2000 atoms (0.00002 KVNC)
- Atom = 10^8 (8 decimals)
- Genesis premine coinbase recipient: cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc

## P2P bootstrap
- seed.kovanica.online:9000
- seed2.kovanica.online:9001
- seed3.kovanica.online:9000

## Running a node
KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_PEERS=seed.kovanica.online:9000,seed3.kovanica.online:9000 KOVANICA_MINE=1 KOVANICA_POW=1 ./kovanica-node explorer 127.0.0.1:8080`}
      </pre>
    </div>
  );
}

function MinePanel({ network, genesis }: { network: string; genesis: string }) {
  const installScript = "curl -fsSL https://explorer.kovanica.online/download/install.sh | sh";
  return (
    <div className="rounded-lg border border-border bg-surface p-4 max-w-3xl">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Mine {network.replace(/[^a-z0-9-]/gi, "")}</p>
      <h2 className="mt-3 font-display text-xl text-fg">Join the network in one command</h2>
      <p className="mt-2 text-sm text-muted">
        Downloads the Kovanica node for your machine (Linux x64 / arm64),
        installs it to <code>~/.local/bin</code>, and starts a systemd service that syncs from
        <span className="font-mono">seed.kovanica.online:9000</span> and mines one block per minute on average.
        No root required. Uninstall any time with <code>--uninstall</code>.
      </p>
      <div className="mt-4 flex gap-2 items-center">
        <code className="flex-1 min-w-[280px] bg-bg px-4 py-3 rounded border border-border font-mono text-sm text-fg">{installScript}</code>
        <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(installScript)}>
          Copy
        </Button>
      </div>
      <div className="mt-4 flex gap-2 flex-wrap">
        <Button type="button" variant="ghost" size="sm" asChild>
          <a href="/download/install.sh" target="_blank" rel="noopener">Download install.sh</a>
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild>
          <a href="/download/kovanica-node-linux-x64" target="_blank" rel="noopener">Linux x64 binary</a>
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild>
          <a href="/download/kovanica-node-linux-arm64" target="_blank" rel="noopener">Linux arm64 binary</a>
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted">Prefer manual? After downloading, mark it executable and run:</p>
      <pre className="mt-2 bg-bg px-4 py-3 rounded border border-border font-mono text-xs text-fg overflow-x-auto">
        {`chmod +x kovanica-node-linux-x64
KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_PEERS=seed.kovanica.online:9000,seed3.kovanica.online:9000 \\
KOVANICA_MINE=1 KOVANICA_MINE_SECS=60 KOVANICA_POW=1 KOVANICA_DATA=~/.kovanica \\
./kovanica-node-linux-x64 explorer 127.0.0.1:18080`}
      </pre>
      <p className="mt-3 text-sm text-muted">
        Verify your node is synced: <code className="font-mono bg-bg px-1.5 py-0.5 rounded text-fg">curl http://127.0.0.1:18080/api/head</code>
        — genesis must match this network (<span className="font-mono text-fg">{genesis.slice(0, 16)}…</span>).
        Mining uses real proof-of-work; difficulty retargets with network hash rate.
      </p>
    </div>
  );
}

function WalletPanel({
  wallet,
  setWallet,
  walletBal,
  setWalletBal,
  walletHist,
  setWalletHist,
  walletMsg,
  setWalletMsg,
  node,
  hwConnected,
  setHwConnected,
  act,
}: {
  wallet: WalletRec | null;
  setWallet: (w: WalletRec | null) => void;
  walletBal: number | null;
  setWalletBal: (b: number | null) => void;
  walletHist: ApiHistoryTx[];
  setWalletHist: (h: ApiHistoryTx[]) => void;
  walletMsg: string;
  setWalletMsg: (m: string) => void;
  node: ApiNode | undefined;
  hwConnected: { deviceType: string; address: string } | null;
  setHwConnected: (c: { deviceType: string; address: string } | null) => void;
  act: (path: string) => Promise<unknown>;
}) {
  const [bipPath, setBipPath] = useState({ account: 0, change: 0, index: 0 });
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("1");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const minFee = node?.min_fee ?? MIN_FEE;
  const atomVal = node?.atom ?? ATOM;

  async function createWallet() {
    setCreating(true);
    try {
      const mnemonic = await createMnemonic();
      const seed64 = mnemonicToSeed(mnemonic);
      const seed32 = await bip44Seed(seed64, KOVANICA_COIN_TYPE, bipPath.account, bipPath.change, bipPath.index);
      const keys = await keysFromSeed32(seed32);
      const path = `m/44'/${KOVANICA_COIN_TYPE}'/${bipPath.account}'/${bipPath.change}/${bipPath.index}`;
      setWallet({
        type: "mnemonic",
        mnemonic,
        jwk: keys.jwk,
        account: bipPath.account,
        change: bipPath.change,
        index: bipPath.index,
        path,
        address: keys.address,
        mnemonicShown: true,
      });
      setWalletMsg("write down the 12 words");
      setWalletBal(null);
      setWalletHist([]);
    } catch (e) {
      setWalletMsg(`err ${(e as Error).message || "this browser has no Ed25519 WebCrypto"}`);
    } finally {
      setCreating(false);
    }
  }

  async function importWallet(phrase: string) {
    setImporting(true);
    try {
      const mnemonic = await importMnemonic(phrase);
      const seed64 = mnemonicToSeed(mnemonic);
      const seed32 = await bip44Seed(seed64, KOVANICA_COIN_TYPE, bipPath.account, bipPath.change, bipPath.index);
      const keys = await keysFromSeed32(seed32);
      const path = `m/44'/${KOVANICA_COIN_TYPE}'/${bipPath.account}'/${bipPath.change}/${bipPath.index}`;
      setWallet({
        type: "mnemonic",
        mnemonic,
        jwk: keys.jwk,
        account: bipPath.account,
        change: bipPath.change,
        index: bipPath.index,
        path,
        address: keys.address,
        mnemonicShown: false,
      });
      setWalletMsg("imported");
      setWalletBal(null);
      setWalletHist([]);
    } catch (e) {
      setWalletMsg(`err ${(e as Error).message || "import failed"}`);
    } finally {
      setImporting(false);
    }
  }

  async function switchAccount() {
    if (!wallet) return;
    const seed64 = mnemonicToSeed(wallet.mnemonic!);
    const seed32 = await bip44Seed(seed64, KOVANICA_COIN_TYPE, bipPath.account, bipPath.change, bipPath.index);
    const keys = await keysFromSeed32(seed32);
    const path = `m/44'/${KOVANICA_COIN_TYPE}'/${bipPath.account}'/${bipPath.change}/${bipPath.index}`;
    setWallet({ ...wallet, account: bipPath.account, change: bipPath.change, index: bipPath.index, path, address: keys.address, mnemonicShown: wallet.mnemonicShown });
    setWalletBal(null);
    setWalletHist([]);
  }

  async function walletSign(sighashHex: string) {
    if (!wallet || wallet.type === "hardware") throw new Error("No software wallet");
    const hex = sighashHex.trim().toLowerCase();
    const sig = await signSighash(wallet.mnemonic!, wallet.index, hex);
    return sig;
  }

  async function faucet() {
    if (!wallet) return;
    try {
      const r = await act(`/api/faucet?to=${wallet.address}&amount=${atomVal}`);
      setWalletMsg("ok faucet paid 1 KVNC");
    } catch {
      setWalletMsg("err faucet");
    }
  }

  async function send() {
    if (!wallet || !sendTo || !sendAmount) return;
    if (!isAddr(sendTo)) { setWalletMsg("err bad to address"); return; }
    try {
      const amount = Math.round(parseFloat(sendAmount) * atomVal);
      if (!amount || amount <= 0) { setWalletMsg("err bad amount"); return; }
      const prep = await act(`/api/prepare?from=${wallet.address}&to=${sendTo}&amount=${amount}&fee=${minFee}`);
      if (!prep || typeof prep !== "object" || !((prep as any).ok)) { setWalletMsg("err prepare"); return; }
      const prepAny = prep as any;
      const sig = await walletSign(prepAny.sighash);
      const sub = await act(`/api/submit?from=${wallet.address}&to=${sendTo}&amount=${amount}&sig=${sig}&fee=${minFee}`);
      if (!sub || typeof sub !== "object" || !((sub as any).ok)) { setWalletMsg("err submit"); return; }
      await act("/api/produce");
      setWalletMsg(`ok tx ${(sub as any).tx} (fee: ${fmtKvnc(minFee)})`);
      setSendTo(""); setSendAmount("1");
    } catch (e) {
      setWalletMsg(`err ${(e as Error).message || "send failed"}`);
    }
  }

  const showMnemonic = wallet?.mnemonicShown && wallet.mnemonic;
  const qrSrc = wallet?.address ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(wallet.address)}` : "";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        {wallet ? (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">{wallet.type === "hardware" ? "Hardware Wallet" : "BIP44 Path"}</p>
            <p className="mt-1 font-mono text-sm text-fg break-all">{wallet.path}</p>
            <p className="mt-2 font-mono text-fg break-all">{wallet.address}</p>
            {qrSrc && (
              <img className="mt-3 rounded border border-border" alt="address QR" src={qrSrc} />
            )}
            <p className="mt-3 text-sm text-muted">
              Balance {walletBal === null ? "..." : fmtKvnc(walletBal)}. 1 KVNC = {atomVal.toLocaleString()} atoms.
              {wallet.type === "hardware" ? "Keys stored on hardware device." : "Secret stays in this browser."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(wallet.address)}>Copy address</Button>
              {node?.faucet && (
                <Button type="button" variant="outline" size="sm" onClick={faucet}>Faucet 1 KVNC</Button>
              )}
              {wallet.type !== "hardware" && (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setWallet({ ...wallet, mnemonicShown: !wallet.mnemonicShown })}>
                    {wallet.mnemonicShown ? "Hide seed" : "Show seed"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setWallet(null)}>Forget</Button>
                </>
              )}
            </div>
            {showMnemonic && (
              <p className="mt-3 font-mono text-sm text-fg">{wallet.mnemonic}</p>
            )}
            {walletMsg && (
              <p className={`mt-2 text-sm ${walletMsg.startsWith("err") ? "text-danger" : "text-ok"}`}>{walletMsg}</p>
            )}
            <p className="mt-4 text-[10px] tracking-wide text-subtle uppercase">Send</p>
            <div className="mt-2 flex flex-col gap-2">
              <label className="text-[10px] text-subtle uppercase">To (64-hex or kvnc…dag)</label>
              <input className="w-full" type="text" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="64-hex address" />
              <label className="text-[10px] text-subtle uppercase">Amount (KVNC)</label>
              <div className="flex gap-2">
                <input className="flex-1" type="text" inputMode="decimal" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} />
                <Button type="button" variant="primary" size="sm" onClick={send} disabled={!sendTo || !sendAmount}>
                  Sign & send
                </Button>
              </div>
              <p className="text-xs text-muted">Network fee {fmtKvnc(minFee)} paid to the miner.</p>
            </div>
            <p className="mt-4 text-[10px] tracking-wide text-subtle uppercase">History (last 20)</p>
            {walletHist.length === 0 ? (
              <p className="text-sm text-muted">No txs yet.</p>
            ) : (
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
                {walletHist.slice().reverse().map((t) => (
                  <li key={t.tx}>{t.kind} {fmtKvnc(Math.abs(t.delta))} · {shortId(t.tx)}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-muted">Create a BIP39 12-word wallet or import a phrase. The node never sees the seed.</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button type="button" variant="primary" size="sm" onClick={createWallet} disabled={creating}>
                {creating ? "Creating…" : "Create 12-word wallet"}
              </Button>
            </div>
            <div className="mt-4 border-t border-border">
              <p className="text-sm text-muted">Or import a 12 or 24-word BIP39 phrase:</p>
              <textarea className="mt-2 w-full min-h-[80px]" placeholder="twelve words" rows={3} disabled={importing}></textarea>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
                const el = document.querySelector("textarea");
                if (el) importWallet((el as HTMLTextAreaElement).value);
              }} disabled={importing}>
                {importing ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        )}

        {wallet && wallet.type !== "hardware" && (
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">BIP44 Path</p>
            <p className="mt-1 font-mono text-sm text-fg">m/44'/{KOVANICA_COIN_TYPE}'/account'/change/index</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-subtle uppercase">Account</label>
                <input type="number" min={0} max={20} value={bipPath.account} onChange={(e) => setBipPath({ ...bipPath, account: parseInt(e.target.value) || 0 })} className="mt-1 w-full" />
              </div>
              <div>
                <label className="text-[10px] text-subtle uppercase">Change (0=ext, 1=int)</label>
                <input type="number" min={0} max={1} value={bipPath.change} onChange={(e) => setBipPath({ ...bipPath, change: parseInt(e.target.value) || 0 })} className="mt-1 w-full" />
              </div>
              <div>
                <label className="text-[10px] text-subtle uppercase">Index</label>
                <input type="number" min={0} max={20} value={bipPath.index} onChange={(e) => setBipPath({ ...bipPath, index: parseInt(e.target.value) || 0 })} className="mt-1 w-full" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={switchAccount}>
              Switch
            </Button>
          </div>
        )}

        {wallet && wallet.type === "hardware" && (
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Hardware Wallet</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={!("hid" in navigator)}>Connect Ledger (WebHID)</Button>
              <Button type="button" variant="ghost" size="sm" disabled={!("usb" in navigator)}>Connect Trezor (WebUSB)</Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <p className="text-[10px] tracking-wide text-subtle uppercase">Network actors</p>
        <p className="mt-2 text-sm text-muted">
          Premine {fmtKvnc(node?.subsidy ?? 0)} + decaying issuance. Miner is {node?.miner ? shortId(node.miner) : "founder"}.
          {node?.faucet ? "Faucet pays from actor 1." : "Faucet is off."}
        </p>
        {hwConnected && (
          <div className="mt-3 rounded border border-border bg-surface p-3">
            <p className="text-[10px] text-subtle uppercase">Hardware connected</p>
            <p className="mt-1 font-mono text-fg">{hwConnected.deviceType} · {hwConnected.address}</p>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {(node?.wallets ?? []).map((w) => (
            <div key={w.seed} className="rounded border border-border bg-surface p-3">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="text-[10px] text-subtle uppercase">Actor {w.seed}{w.seed === 1 ? " · faucet" : ""}</p>
                  <p className="mt-0.5 font-mono text-xs text-fg break-all">{w.address}</p>
                </div>
                <p className="font-mono text-fg">{fmtKvnc(w.balance)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
