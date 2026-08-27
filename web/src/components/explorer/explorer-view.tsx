import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DagCanvas, DagLegend } from "@/components/explorer/dag-canvas";
import { dagToBlocks } from "@/lib/api/map-blocks";
import { useNode } from "@/lib/api/use-node";
import { fmtKvnc } from "@/lib/ledger/format";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/ledger/types";
import type { ApiNode } from "@/lib/api/contract";

const TABS = ["Graph", "Mempool", "Order", "Blocks", "Analytics"] as const;
type Tab = (typeof TABS)[number];

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
  const n = state?.node;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-fg">BlockDAG</h1>
          <p className="mt-0.5 text-xs text-muted md:text-sm">
            Native token <strong className="text-fg">Kovanica (KVNC)</strong> on {state?.network ?? "kovanica-testnet"}.
            Subsidy halves every {n?.halving_era ?? 500_000} blocks.
            {error ? <span className="text-danger"> · {error}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide text-subtle uppercase">
            {state?.mining ? "mining" : "paused"} · {source}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            disabled={!state?.operator}
            onClick={() => void act("/api/mine")}
          >
            <Hammer className="size-3.5" />
            Mine
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            disabled={!state?.operator}
            onClick={() => void act(`/api/mining?on=${state?.mining ? 0 : 1}`)}
          >
            {state?.mining ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {state?.mining ? "Pause" : "Resume"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            disabled={!state?.allow_reset}
            onClick={() => void act("/api/reset")}
          >
            <RotateCcw className="size-3.5" />
            Reset
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
        {tab === "Graph" ? <GraphPanel selected={selected} node={n} /> : null}
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
        {tab === "Analytics" ? <AnalyticsPanel node={n} /> : null}
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

function GraphPanel({ selected, node: _node }: { selected: Block | null; node: ApiNode | undefined }) {
  if (!selected) {
    return <p className="text-sm text-muted">Select a block on the graph.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <article className="rounded-lg border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Block</p>
        <p className="mt-1 font-mono text-sm break-all text-fg">{selected.id}</p>
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
        <p className="text-[10px] tracking-wide text-subtle uppercase">Transactions</p>
        <ul className="mt-2 space-y-2 font-mono text-xs text-muted">
          {selected.txs.map((tx) => (
            <li key={tx.id}>
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
      <p className="text-sm text-muted mb-3">
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
    <ol className="font-mono text-xs text-muted list-decimal pl-5">
      {node.order.map((id, i) => (
        <li key={id} className="py-1">
          <span className="text-subtle">{i}</span> · {id}
          {id === node.selected_tip && <span className="text-accent ml-2">← tip</span>}
        </li>
      ))}
    </ol>
  );
}

function AnalyticsPanel({ node }: { node: ApiNode | undefined }) {
  if (!node) {
    return <p className="text-sm text-muted">No data available.</p>;
  }

  const totalBlocks = node.blocks || 0;
  const totalTxs = node.tx_count || 0;
  const avgTxsPerBlock = totalBlocks > 0 ? (totalTxs / totalBlocks).toFixed(2) : "0";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-display text-lg text-fg mb-3">Network Health</h3>
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
            <dd className="font-mono text-fg">{node.mempool} txs</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-display text-lg text-fg mb-3">DAG Structure</h3>
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
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-display text-lg text-fg mb-3">Economics</h3>
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
            <dt className="text-subtle">Halving Era</dt>
            <dd className="font-mono text-fg">{node.halving_era} blocks</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-subtle">PoW</dt>
            <dd className="font-mono text-fg">{node.pow ? "enabled" : "disabled"}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-display text-lg text-fg mb-3">Genesis</h3>
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
            <dd className="font-mono text-fg break-all">{shortId(node.genesis)}</dd>
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
