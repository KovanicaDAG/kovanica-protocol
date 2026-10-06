import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Blocks,
  Coins,
  Cpu,
  Gauge,
  Globe,
  Layers,
  Radio,
  Server,
  Shield,
  Wifi,
} from "lucide-react";
import { api, useApiSource } from "@/lib/api/client";
import {
  ATOM,
  K,
  MAINNET_ID,
  MAX_SUPPLY,
  NETWORK_ID,
  TOKEN,
  type ApiBootstrap,
  type ApiHead,
  type ApiNode,
  type ApiState,
} from "@/lib/api/contract";
import { shortId } from "@/lib/ledger/hash";
import { SourceSwitch } from "@/components/layout/source-switch";
import { DagMark } from "@/components/brand/dag-mark";
import { Button } from "@/components/ui/button";
import { StatCard } from "./stat-card";
import { HeightChart } from "./height-chart";

type HeightSample = { at: number; blocks: number };

const HISTORY_LEN = 60;

/** Atoms → KVNC string (no symbol; the card label carries it). */
function kvnc(atoms: number): string {
  return (atoms / ATOM).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function Dashboard() {
  const source = useApiSource();
  const isMainnet = source === "mainnet";

  const [head, setHead] = useState<ApiHead | null>(null);
  const [bootstrap, setBootstrap] = useState<ApiBootstrap | null>(null);
  const [node, setNode] = useState<ApiNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<HeightSample[]>([]);

  useEffect(() => {
    // Mainnet has no public endpoint yet — show the placeholder, no polling.
    if (isMainnet) {
      setHead(null);
      setBootstrap(null);
      setNode(null);
      setError(null);
      history.current = [];
      return;
    }

    let alive = true;

    const pushSample = (h: ApiHead) => {
      const arr = history.current;
      arr.push({ at: Date.now(), blocks: h.blocks });
      if (arr.length > HISTORY_LEN) arr.splice(0, arr.length - HISTORY_LEN);
    };

    const report = (e: unknown) => {
      if (!alive) return;
      setError(e instanceof Error ? e.message : "source offline");
    };

    const loadHead = async () => {
      try {
        const h = await api<ApiHead>("/api/head");
        if (!alive) return;
        pushSample(h);
        setHead(h);
        setError(null);
      } catch (e) {
        report(e);
      }
    };
    const loadBootstrap = async () => {
      try {
        const b = await api<ApiBootstrap>("/api/bootstrap");
        if (alive) setBootstrap(b);
      } catch (e) {
        report(e);
      }
    };
    const loadState = async () => {
      try {
        const s = await api<ApiState>("/api/state");
        if (alive) setNode(s.node);
      } catch (e) {
        report(e);
      }
    };

    void loadHead();
    void loadBootstrap();
    void loadState();
    const idHead = window.setInterval(() => void loadHead(), 2_500);
    const idBootstrap = window.setInterval(() => void loadBootstrap(), 5_000);
    const idState = window.setInterval(() => void loadState(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(idHead);
      window.clearInterval(idBootstrap);
      window.clearInterval(idState);
    };
  }, [source, isMainnet]);

  if (isMainnet) {
    return <MainnetPlaceholder />;
  }

  const h = head;
  const b = bootstrap;
  const n = node;
  const samples = history.current;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
            dash · kovanica
          </p>
          <h1 className="font-display text-3xl tracking-tight text-fg">Network dashboard</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Live node stats for the selected source. Auto-refreshes; height is
            sampled every 2.5&nbsp;s.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="hidden font-mono text-[10px] tracking-wide text-subtle uppercase sm:inline">
            Source
          </span>
          <SourceSwitch />
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!h && !error && (
        <p className="py-12 text-center text-sm text-muted">Loading live stats…</p>
      )}

      {h && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Headline stats">
          <StatCard
            icon={Globe}
            label="Network"
            value={h.network}
            sub={`k = ${K} · poa · ${h.atom.toLocaleString()} atoms`}
          />
          <StatCard
            icon={Blocks}
            label="Blocks"
            value={h.blocks.toLocaleString()}
            sub={`tip ${shortId(h.tip)}`}
            accent="gold"
          />
          <StatCard
            icon={Coins}
            label="Supply"
            value={
              n
                ? `${kvnc(n.supply)} ${TOKEN}`
                : "—"
            }
            sub={
              n
                ? `${((n.supply / MAX_SUPPLY) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% of ${kvnc(MAX_SUPPLY)}M cap`
                : `cap ${kvnc(MAX_SUPPLY)}M ${TOKEN}`
            }
          />
          <StatCard
            icon={Gauge}
            label="Subsidy / era"
            value={b ? `${kvnc(b.subsidy)} ${TOKEN}` : "—"}
            sub={n ? `era ${n.halving_era} · min fee ${h.min_fee.toLocaleString()} atoms` : `min fee ${h.min_fee.toLocaleString()} atoms`}
          />
        </section>
      )}

      {h && (
        <section className="rounded-xl border border-border bg-surface p-4" aria-label="Block height">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[10px] tracking-wide text-subtle uppercase">
              <Activity className="size-3.5" />
              Block height
            </p>
            <p className="font-mono text-[10px] text-subtle uppercase">
              live · {h.blocks.toLocaleString()}
            </p>
          </div>
          <div className="mt-3 h-40">
            <HeightChart samples={samples} />
          </div>
        </section>
      )}

      {n && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Node metrics">
          <StatCard
            icon={Server}
            label="Peers"
            value={String((b?.peers?.length ?? 0) + 1)}
            sub={`listen ${b?.listen ?? "—"}`}
          />
          <StatCard icon={Layers} label="Mempool" value={n.mempool.toLocaleString()} sub="pending txs" />
          <StatCard icon={Cpu} label="Tx count" value={n.tx_count.toLocaleString()} sub={`${n.utxos.toLocaleString()} utxos`} />
          <StatCard icon={Shield} label="Blue score" value={n.blue_score.toLocaleString()} sub={`${n.tips.length} tips`} />
        </section>
      )}

      {b && (
        <section className="rounded-xl border border-border bg-surface p-4" aria-label="P2P + upstream">
          <div className="flex items-center gap-2">
            <Wifi className="size-4 text-teal" />
            <p className="text-[10px] tracking-wide text-subtle uppercase">P2P / upstream</p>
          </div>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] tracking-wide text-subtle uppercase">Listen</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-fg">{b.listen}</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-wide text-subtle uppercase">Bootstrap seeds</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-fg">
                {b.peers.length > 0 ? b.peers.join(" · ") : "seed.kovanica.online:9000"}
              </dd>
            </div>
          </dl>
          {b.upstream && (
            <div className="mt-3 rounded-lg border border-border px-3 py-2">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Upstream probe</p>
              {b.upstream.ok ? (
                <p className="mt-1 flex items-center gap-2 font-mono text-sm text-ok">
                  <Radio className="size-3.5" />
                  OK · tip {shortId(b.upstream.head.tip)} · {b.upstream.head.blocks.toLocaleString()} blocks
                </p>
              ) : (
                <p className="mt-1 text-sm text-danger">{b.upstream.error}</p>
              )}
            </div>
          )}
        </section>
      )}

      <p className="text-center font-mono text-[11px] text-subtle">
        {NETWORK_ID} · {TOKEN} · GHOSTDAG k={K} · finality 100 · fee 75% burned · maturity 100
      </p>
    </div>
  );
}

/** Placeholder panel for the mainnet tab — no live endpoint yet. */
function MainnetPlaceholder() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
            dash · kovanica
          </p>
          <h1 className="font-display text-3xl tracking-tight text-fg">Network dashboard</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Live node stats for the selected source.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="hidden font-mono text-[10px] tracking-wide text-subtle uppercase sm:inline">
            Source
          </span>
          <SourceSwitch />
        </div>
      </header>

      <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center">
        <DagMark variant="gold" className="mx-auto size-10" />
        <p className="eyebrow mt-5">{MAINNET_ID} · KVNC</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight text-fg italic">
          Mainnet is launching soon.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
          The production network is being finalized. Live stats will appear here
          the moment the mainnet node opens its public endpoint.
        </p>
        <ul className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2 font-mono text-[10px] tracking-wide text-muted uppercase">
          <li className="rounded-md border border-border px-2 py-1">k = {K}</li>
          <li className="rounded-md border border-border px-2 py-1">GHOSTDAG</li>
          <li className="rounded-md border border-border px-2 py-1">poa</li>
          <li className="rounded-md border border-border px-2 py-1">finality 100</li>
          <li className="rounded-md border border-border px-2 py-1">maturity 100</li>
          <li className="rounded-md border border-border px-2 py-1">fee 75% burned</li>
          <li className="rounded-md border border-border px-2 py-1">cap {kvnc(MAX_SUPPLY)}M</li>
        </ul>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild variant="gold" className="h-11 px-6">
            <a href="https://testnet.kovanica.online/explorer">Open Testnet Explorer</a>
          </Button>
          <Button asChild variant="outline" className="h-11 px-6">
            <a href="https://testnet.kovanica.online">Open wallet</a>
          </Button>
        </div>
        <p className="mt-6 font-mono text-[10px] tracking-wide text-subtle uppercase">
          {MAINNET_ID} · {TOKEN}
        </p>
      </div>
    </div>
  );
}