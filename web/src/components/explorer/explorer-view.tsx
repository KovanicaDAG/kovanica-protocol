// @ts-nocheck — pre-existing explorer wallet panel types; tracked separately
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssetBadge, AssetOutputRow } from "@/components/explorer/asset-badge";
import { DagCanvas, DagLegend } from "@/components/explorer/dag-canvas";
import { dagToBlocks } from "@/lib/api/map-blocks";
import { useNode } from "@/lib/api/use-node";
import { fmtKvnc } from "@/lib/ledger/format";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/ledger/types";
import { isNativeAsset, type ApiNode, type ApiDagBlock } from "@/lib/api/contract";

const TABS = ["Graph", "Mempool", "Order", "Blocks", "Docs", "Console", "Analytics", "Mine"] as const;
type Tab = (typeof TABS)[number];

/** Explorer BlockDAG surface. Full wallet panel lives on /wallet. */
export function ExplorerView() {
  const { state, error, act, source } = useNode(1800);
  const [tab, setTab] = useState<Tab>("Graph");
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);

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
            Subsidy era every {n?.halving_era ?? 2_000_000} blocks.
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
        {tab === "Analytics" ? <AnalyticsPanel node={n} /> : null}
        {tab === "Docs" ? <DocsPanel /> : null}
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

function GraphPanel({ selected, apiBlock }: { selected: Block | null; apiBlock: ApiDagBlock | null }) {
  if (!selected) return <p className="text-sm text-muted">Select a block on the graph.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <article className="rounded-lg border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Block</p>
        <p className="mt-1 break-all font-mono text-sm text-fg">{selected.id}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between"><dt className="text-xs text-subtle">Colour</dt><dd className="font-mono capitalize text-fg">{selected.colour}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Blue score</dt><dd className="font-mono tabular-nums text-fg">{selected.blueScore}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Height</dt><dd className="font-mono tabular-nums text-fg">{selected.height}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Parents</dt><dd className="font-mono text-fg">{selected.parents.length}</dd></div>
        </dl>
      </article>
      <aside className="rounded-lg border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Transactions</p>
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
              <ul className="mt-2 space-y-1.5">
                {tx.outputs.map((o, i) => (
                  <AssetOutputRow key={`${tx.id}-${i}`} value={o.value} assetId={o.asset_id} owner={o.owner} formatValue={fmtKvnc} shortOwner={shortId} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function BlocksTable({ blocks, selectedId, onSelect }: { blocks: Block[]; selectedId: string | null; onSelect: (id: string) => void }) {
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
            <tr key={b.id} className={cn("cursor-pointer border-t border-border", b.id === selectedId ? "bg-surface-2" : "hover:bg-surface")} onClick={() => onSelect(b.id)}>
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
      <p className="mb-3 text-sm text-muted">Min fee {fmtKvnc(node.min_fee)}. {node.pending.length} in pool.</p>
      <ul className="font-mono text-xs text-muted space-y-1">
        {node.pending.map((id) => (
          <li key={id}>mempool · {shortId(id)}</li>
        ))}
      </ul>
    </div>
  );
}

function OrderPanel({ node }: { node: ApiNode | undefined }) {
  if (!node || node.order.length === 0) return <p className="text-sm text-muted">No blocks in order.</p>;
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

function AnalyticsPanel({ node }: { node: ApiNode | undefined }) {
  if (!node) return <p className="text-sm text-muted">No data available.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-display text-lg text-fg">Network</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-subtle">Blocks</dt><dd className="font-mono">{node.blocks}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Txs</dt><dd className="font-mono">{node.tx_count}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Supply</dt><dd className="font-mono">{fmtKvnc(node.supply)}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Blue score</dt><dd className="font-mono">{node.blue_score}</dd></div>
        </dl>
      </div>
    </div>
  );
}

function ConsolePanel({ node, events }: { node: ApiNode | undefined; events: { at?: string; kind?: string; from?: string; to?: string }[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface/50 p-4 max-h-[400px]">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Mempool</p>
      <ul className="font-mono text-xs text-muted space-y-1">
        {(node?.pending ?? []).map((id) => (
          <li key={id}>mempool {shortId(id)}</li>
        ))}
      </ul>
      <p className="mt-4 text-[10px] tracking-wide text-subtle uppercase">Gossip (last 40)</p>
      <ul className="font-mono text-xs text-muted space-y-1">
        {events.slice(-40).reverse().map((e, i) => (
          <li key={i}>{e.at ?? ""} {e.kind ?? ""} {e.from ?? ""} → {e.to ?? ""}</li>
        ))}
      </ul>
    </div>
  );
}

function DocsPanel() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">See TESTNET.md and /docs for node ops. Wallet lives at /wallet.</p>
    </div>
  );
}

function MinePanel({ network, genesis }: { network: string; genesis: string }) {
  const installScript = "curl -fsSL https://explorer.kovanica.online/download/install.sh | sh";
  return (
    <div className="rounded-lg border border-border bg-surface p-4 max-w-3xl">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Mine {network}</p>
      <h2 className="mt-3 font-display text-xl text-fg">Join the network</h2>
      <code className="mt-4 block bg-bg px-4 py-3 rounded border border-border font-mono text-sm">{installScript}</code>
      <p className="mt-3 text-sm text-muted">Genesis {genesis ? shortId(genesis) : "—"}. Prefer /wallet for sends.</p>
    </div>
  );
}
