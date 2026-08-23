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

const TABS = ["Graph", "Blocks", "Mempool"] as const;
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
            Native token <strong className="text-fg">Kovanica (KVNC)</strong> on {state?.network ?? "kovanica-testnet-1"}.
            Subsidy halves every 1000 blocks.
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

      <dl className="grid grid-cols-3 border-b border-border bg-border md:grid-cols-6">
        <Stat label="Blocks" value={String(n?.blocks ?? "—")} />
        <Stat label="Tips" value={String(n?.tips.length ?? "—")} />
        <Stat label="Blue score" value={String(n?.blue_score ?? "—")} />
        <Stat label="Chain" value={String(n?.chain_len ?? "—")} />
        <Stat label="Supply" value={n ? fmtKvnc(n.supply) : "—"} />
        <Stat label="Mempool" value={String(n?.mempool ?? "—")} />
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
        {tab === "Graph" ? <GraphPanel selected={selected} /> : null}
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
        {tab === "Mempool" ? (
          !n || n.pending.length === 0 ? (
            <p className="text-sm text-muted">Mempool is empty. Send from the wallet to queue a transfer.</p>
          ) : (
            <ul className="font-mono text-xs text-muted">
              {n.pending.map((id) => (
                <li key={id} className="border-b border-border py-2">
                  {shortId(id)}
                </li>
              ))}
            </ul>
          )
        ) : null}
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

function GraphPanel({ selected }: { selected: Block | null }) {
  if (!selected) {
    return <p className="text-sm text-muted">Select a block on the graph.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <article className="rounded-lg border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Block</p>
        <p className="mt-1 font-mono text-sm break-all text-fg">{selected.id}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-subtle">Colour</dt>
            <dd className="capitalize">{selected.colour}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Blue score</dt>
            <dd className="font-mono tabular-nums">{selected.blueScore}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Height</dt>
            <dd className="font-mono tabular-nums">{selected.height}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Parents</dt>
            <dd className="font-mono">{selected.parents.length}</dd>
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
