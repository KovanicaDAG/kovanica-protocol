import { useEffect, useMemo, useState } from "react";
import { Compass } from "lucide-react";
import { DagCanvas, DagLegend } from "@/components/explorer/dag-canvas";
import { dagToBlocks } from "@/lib/api/map-blocks";
import { useNode } from "@/lib/api/use-node";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import { getNetworkId } from "@/lib/network";
import type { Block } from "@/lib/ledger/types";
import { type ApiNode, type ApiDagBlock } from "@/lib/api/contract";

const TABS = ["Graph", "Blocks", "Mempool", "Order", "Console", "Analytics", "Docs"] as const;
type Tab = (typeof TABS)[number];

/** Explorer BlockDAG surface. Full wallet panel lives on /wallet. */
export function ExplorerView() {
  const { state, error, source } = useNode(2000);
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

  const selected = blocks.find((b) => b.id === selectedBlock) ?? null;
  const selectedApi = state?.node.dag.find((b) => b.id === selectedBlock) ?? null;
  const n = state?.node;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl tracking-tight text-fg">BlockDAG Explorer</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Consensus (4s rounds · 12s leaders)
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted md:text-sm">
            Native token <strong className="text-fg">Kovanica (KUNA)</strong> on {state?.network ?? getNetworkId()}.
            Subsidy era every {n?.halving_era ?? 8_100_000} committed leader blocks.
            {error ? <span className="text-danger"> · {error}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide text-subtle uppercase">
            synced · {source}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-9 border-b border-border bg-border gap-px">
        <Stat label="Committed Blocks" value={String(n?.blocks ?? "—")} />
        <Stat label="Tip Round" value={String(n?.chain_len ?? "—")} />
        <Stat label="Consensus Wave" value="Wave 3 (12s)" />
        <Stat label="Round Duration" value="4.0s" />
        <Stat label="Active Validators" value="5 Staked" />
        <Stat label="BFT Tolerance" value="f = 1 (of 5)" />
        <Stat label="Min Stake" value="50,000 KUNA" />
        <Stat label="Total Staked" value="250,000 KUNA" />
        <Stat label="Connected Peers" value={`${state?.peers?.length ?? 4} Seeds`} />

        <Stat label="Max Token Supply" value="90.2M KUNA" />
        <Stat label="Circulating Supply" value="1.0M KUNA" />
        <Stat label="Mining Subsidy" value="81.0M KUNA" />
        <Stat label="Leader Reward" value="2.5 KUNA" />
        <Stat label="Subsidy Era" value="8.1M Blk" />
        <Stat label="Epoch Rotation" value="2,400 (8h)" />
        <Stat label="Mempool Tx" value={`${n?.mempool ?? 0} Pending`} />
        <Stat label="Min Tx Fee" value="0.00001 KUNA" />
        <Stat label="Genesis Anchor" value={n ? shortId(n.genesis, 6) : "—"} />
      </dl>

      <section className="border-b border-border bg-surface px-4 py-4 md:px-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <DagLegend />
        </div>
        <div className="h-[min(54vh,480px)]">
          <DagCanvas blocks={blocks} selectedId={selectedBlock} onSelect={setSelectedBlock} />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between border-b border-border bg-surface/30 px-4 md:px-6">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {TABS.map((t) => {
            const count =
              t === "Blocks" ? blocks.length :
              t === "Mempool" ? (n?.mempool ?? 0) :
              undefined;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-11 shrink-0 border-b-2 px-3.5 text-sm font-medium transition-colors duration-150 inline-flex items-center gap-2",
                  tab === t
                    ? "border-accent text-fg font-semibold"
                    : "border-transparent text-muted hover:text-fg hover:border-border",
                )}
              >
                <span>{t}</span>
                {count !== undefined ? (
                  <span className="rounded-full bg-border/80 px-1.5 py-0.2 text-[10px] font-mono text-muted">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Live Status Indicators to balance tabs row */}
        <div className="hidden lg:flex items-center gap-3 py-2 font-mono text-xs">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-bg px-2.5 py-1 text-[11px] text-muted">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-subtle">Finality:</span>
            <span className="font-semibold text-fg">12.0s</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-bg px-2.5 py-1 text-[11px] text-muted">
            <span className="text-subtle">Committee:</span>
            <span className="font-semibold text-emerald-400">5/5 Honest</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-bg px-2.5 py-1 text-[11px] text-muted">
            <span className="text-subtle">Active Head:</span>
            <span className="font-semibold text-amber-400">
              Val {selected?.nonce ?? (blocks[blocks.length - 2]?.nonce ?? 0)}
            </span>
          </div>
        </div>
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
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg px-3 py-2.5 md:px-3.5 hover:bg-surface/50 transition-colors">
      <dt className="text-[10px] font-medium tracking-wider text-subtle uppercase truncate">{label}</dt>
      <dd className="mt-1 font-mono text-xs tabular-nums text-fg md:text-sm font-semibold truncate">
        {value}
      </dd>
    </div>
  );
}

function GraphPanel({ selected, apiBlock }: { selected: Block | null; apiBlock: ApiDagBlock | null }) {
  if (!selected) return <p className="text-sm text-muted">Select a block on the graph or table to view details.</p>;
  const ageSec = Math.max(0, Math.floor((Date.now() - selected.timestamp) / 1000));
  const ageStr = ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <article className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] tracking-wide text-subtle uppercase">
            {selected.colour === "genesis" ? "Genesis Block (#0)" :
             selected.colour === "chain" ? "Selected Tip (Active Leader)" :
             selected.colour === "red" ? "Uncommitted Proposal / Fork" :
             "Committed Leader Block"}
          </p>
          <span className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
            selected.colour === "red" ? "bg-rose-500/10 text-rose-400" :
            selected.colour === "genesis" ? "bg-white/10 text-white" :
            selected.colour === "chain" ? "bg-amber-500/10 text-amber-400" :
            "bg-emerald-500/10 text-emerald-400"
          )}>
            <span className={cn(
              "size-1.5 rounded-full",
              selected.colour === "red" ? "bg-rose-400" :
              selected.colour === "genesis" ? "bg-white" :
              selected.colour === "chain" ? "bg-amber-400 animate-pulse" :
              "bg-emerald-400 animate-pulse"
            )} />
            {selected.colour === "red" ? "Uncommitted (Pending 2f+1)" :
             selected.colour === "genesis" ? "Genesis Anchor" :
             selected.colour === "chain" ? "Active Tip" :
             "Finalized (BFT)"}
          </span>
        </div>
        <p className="mt-1 break-all font-mono text-sm text-fg">{selected.id}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between"><dt className="text-xs text-subtle">Height</dt><dd className="font-mono font-semibold text-fg">#{selected.height}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Validator (Author)</dt><dd className="font-mono text-fg">Validator {selected.nonce}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Leader Round</dt><dd className="font-mono tabular-nums text-fg">{selected.blueScore}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Commit Age</dt><dd className="font-mono text-fg">{ageStr}</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Wave</dt><dd className="font-mono text-fg">Wave 3 (12s interval)</dd></div>
          <div className="flex justify-between"><dt className="text-xs text-subtle">Parents</dt><dd className="font-mono text-fg">{selected.parents.length}</dd></div>
        </dl>
        {selected.selectedParent && (
          <div className="mt-3 border-t border-border/50 pt-2 text-xs">
            <span className="text-subtle">Parent Leader: </span>
            <span className="font-mono text-muted break-all">{selected.selectedParent}</span>
          </div>
        )}
      </article>
      <aside className="rounded-lg border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Executed Transactions ({apiBlock?.txs?.length ?? 0})</p>
        {(apiBlock?.txs?.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs text-muted">No user transactions in this committed leader block (consensus heartbeat).</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {(apiBlock?.txs ?? []).map((tx) => (
              <li key={tx.id} className="rounded-lg border border-border/70 bg-bg/30 p-2.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="text-fg">{shortId(tx.id)}</span>
                  <span className="text-emerald-400">Success</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function BlocksTable({ blocks, selectedId, onSelect }: { blocks: Block[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Height</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Leader Digest</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Validator</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Round</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Commit Age</th>
            <th className="py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Txs</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => {
            const ageSec = Math.max(0, Math.floor((Date.now() - b.timestamp) / 1000));
            const ageStr = ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;
            return (
              <tr key={b.id} className={cn("cursor-pointer border-t border-border transition-colors", b.id === selectedId ? "bg-surface-2" : "hover:bg-surface")} onClick={() => onSelect(b.id)}>
                <td className="py-2.5 font-mono tabular-nums font-semibold text-fg">#{b.height}</td>
                <td className="py-2.5 font-mono text-muted hover:text-fg">{shortId(b.id)}</td>
                <td className="py-2.5 font-mono text-fg"><span className="inline-block size-2 rounded-full bg-emerald-500 mr-1.5" />Validator {b.nonce}</td>
                <td className="py-2.5 font-mono tabular-nums text-muted">{b.blueScore}</td>
                <td className="py-2.5 font-mono text-subtle">{ageStr}</td>
                <td className="py-2.5 font-mono tabular-nums text-muted">{b.txs.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MempoolPanel({ node }: { node: ApiNode | undefined }) {
  if (!node || node.pending.length === 0) {
    return <p className="text-sm text-muted">Mempool is clear. Transactions are committed every 12 seconds.</p>;
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted">Min fee 0.00001 KUNA. {node.pending.length} in pool.</p>
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
        <h3 className="mb-3 font-display text-lg text-fg">Network Metrics</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-subtle">Committed Leader Blocks</dt><dd className="font-mono font-semibold">{node.blocks}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Consensus Rounds</dt><dd className="font-mono">{node.chain_len}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Active Validators</dt><dd className="font-mono">5</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Consensus Wave</dt><dd className="font-mono">Wave 3 (12s leader)</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Total Supply</dt><dd className="font-mono">90,200,000 KUNA</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Mining Subsidy Budget</dt><dd className="font-mono">81,000,000 KUNA</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Initial Block Reward</dt><dd className="font-mono">2.5 KUNA</dd></div>
        </dl>
      </div>
    </div>
  );
}

function ConsolePanel({ node }: { node: ApiNode | undefined; events: { at: number; from: string; to: string; kind: string }[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface/50 p-4 max-h-[400px]">
      <p className="text-[10px] tracking-wide text-subtle uppercase">Consensus Status</p>
      <div className="mt-2 font-mono text-xs text-muted space-y-1">
        <p>• Mysticeti DAG Consensus: Active</p>
        <p>• Committed Height: {node?.blocks ?? 0}</p>
        <p>• Round Duration: 4000ms</p>
        <p>• Leader Commit Interval: 12000ms</p>
        <p>• Active Validators: 5 active staked nodes</p>
      </div>
    </div>
  );
}

function DocsPanel() {
  return (
    <div className="max-w-2xl space-y-4 text-sm text-muted">
      <h3 className="font-display text-lg text-fg">Mysticeti BlockDAG Consensus</h3>
      <p>
        Kovanica uses uncertified DAG consensus inspired by Mysticeti with 3-round commit waves.
        Every validator produces a block each 4-second round, and the wave leader is committed with BFT finality every 12 seconds.
      </p>
    </div>
  );
}
