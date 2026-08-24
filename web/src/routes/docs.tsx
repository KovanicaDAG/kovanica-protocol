import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Terminal } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { SourceSwitch } from "@/components/layout/source-switch";
import { api } from "@/lib/api/client";
import {
  ATOM,
  HALVING_ERA,
  K,
  LIVE_EXPLORER,
  MIN_FEE,
  NETWORK_ID,
  SUBSIDY,
  type ApiBootstrap,
} from "@/lib/api/contract";
import { SPEC_TEXT } from "@/lib/api/spec";

export const Route = createFileRoute("/docs")({ component: DocsPage });

type Endpoint = { method: "GET" | "POST"; path: string; note: string };

const READS: Endpoint[] = [
  { method: "GET", path: "/api/head", note: "genesis, tip, height" },
  { method: "GET", path: "/api/bootstrap", note: "plus listen, peers, upstream probe" },
  { method: "GET", path: "/api/p2p", note: "TCP listen + bootstrap peers" },
  { method: "GET", path: "/api/blocks", note: "octet-stream dump (clone catch-up)" },
  { method: "GET", path: "/api/state", note: "full DAG + flags" },
  { method: "GET", path: "/api/utxos?address=", note: "spendable outputs" },
  { method: "GET", path: "/api/history?address=", note: "deltas per address" },
  { method: "GET", path: "/api/origins", note: "ISO3 pulses" },
];

const WRITES: Endpoint[] = [
  { method: "POST", path: "/api/prepare", note: "sighash + fee + change" },
  { method: "POST", path: "/api/submit", note: "queue signed tx" },
  { method: "POST", path: "/api/produce", note: "pack mempool" },
  { method: "POST", path: "/api/mine", note: "preview coinbase block" },
  { method: "POST", path: "/api/faucet", note: "preview mint from local treasury" },
  { method: "POST", path: "/api/fee_estimate", note: "mempool p90 fee (atoms)" },
  { method: "POST", path: "/api/origin", note: "pulse a country" },
  { method: "GET", path: "/api/spec", note: "this document, text/plain" },
];

const NAV = [
  { id: "status", label: "Status" },
  { id: "chain", label: "Chain" },
  { id: "endpoints", label: "Endpoints" },
  { id: "live", label: "Run a node" },
] as const;

function DocsPage() {
  return (
    <Shell>
      <DocsBody />
    </Shell>
  );
}

function DocsBody() {
  const [boot, setBoot] = useState<ApiBootstrap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api<ApiBootstrap>("/api/bootstrap")
      .then(setBoot)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "offline"));
  }, []);

  const up = boot?.upstream;
  const runNode = SPEC_TEXT.split("## Run a public node")[1]?.trim() ?? "";

  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8 md:max-w-4xl md:px-6 md:py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-64 opacity-60"
        style={{
          background:
            "radial-gradient(42rem 12rem at 50% 0%, color-mix(in oklab, var(--color-blue) 16%, transparent), transparent 70%)",
        }}
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-[10px] tracking-brand text-subtle uppercase">
            <span className="size-1.5 rounded-full bg-ok" />
            {NETWORK_ID}
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight text-fg italic md:text-5xl">
            Technical details
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted md:text-base">
            The HTTP API behind{" "}
            <a
              className="text-fg underline decoration-border underline-offset-4 transition-colors hover:decoration-fg"
              href={LIVE_EXPLORER}
            >
              explorer.kovanica.online
              <ArrowUpRight className="ml-0.5 inline size-3.5 align-baseline" />
            </a>
            . Preview is this app running its own in-browser DAG; Live proxies the public testnet.
          </p>
        </div>
        <SourceSwitch />
      </header>

      <nav className="sticky top-2 z-10 flex flex-wrap gap-1 rounded-xl border border-border bg-bg/90 p-1 backdrop-blur">
        {NAV.map((n) => (
          <a
            key={n.id}
            href={`#${n.id}`}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            {n.label}
          </a>
        ))}
      </nav>

      <section id="status" className="scroll-mt-20">
        <SectionTitle kicker="01" title="Node status" />
        <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          <StatusCard
            title="Preview node"
            ok
            lines={[
              boot ? `${boot.blocks} blocks · tip ${boot.tip.slice(0, 8)}` : "loading…",
              "faucet on · operator on · PoW off",
            ]}
          />
          <StatusCard
            title="Live testnet"
            ok={up?.ok === true}
            lines={
              up?.ok
                ? [`${up.head.blocks} blocks · ${up.head.network}`, `genesis ${up.head.genesis.slice(0, 8)}`]
                : [up?.error ?? err ?? "probing…", "CORS closed — we proxy it"]
            }
          />
        </div>
      </section>

      <section id="chain" className="scroll-mt-20">
        <SectionTitle kicker="02" title="Chain parameters" />
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <Fact k="Token" v="KVNC · 8 decimals" />
          <Fact k="Atom" v={`${ATOM.toLocaleString()} / KVNC`} />
          <Fact k="Subsidy" v={`${SUBSIDY / ATOM} KVNC, half / ${HALVING_ERA}`} />
          <Fact k="Min fee" v={`${MIN_FEE} atoms (burned)`} />
          <Fact k="GHOSTDAG k" v={String(K)} />
          <Fact k="P2P" v="TCP :9000 · seed.kovanica.online:9000" />
        </dl>
      </section>

      <section id="endpoints" className="scroll-mt-20">
        <SectionTitle kicker="03" title="Endpoints" />
        <p className="mt-3 text-sm text-muted">
          Same paths as the public explorer. Add{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-fg">?source=live</code>{" "}
          to route a call through the proxy.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <EndpointTable rows={READS} label="Reads" />
          <div className="border-t border-border" />
          <EndpointTable rows={WRITES} label="Writes & actions" />
        </div>
        <p className="mt-3 text-sm text-muted">
          Plain spec:{" "}
          <a
            className="font-mono text-fg underline decoration-border underline-offset-4 transition-colors hover:decoration-fg"
            href="/api/spec"
          >
            /api/spec
          </a>
          . Wallet signs in the browser; the node never sees the seed.
        </p>
      </section>

      <section id="live" className="scroll-mt-20">
        <SectionTitle kicker="04" title="Going live" />
        <ol className="mt-4 space-y-0 border-l border-border pl-6">
          <Step n={1}>
            Flip the header to <strong className="font-medium text-fg">Live</strong> — reads hit the
            public node through this app.
          </Step>
          <Step n={2}>
            Sends need an Ed25519 signature (128 hex) over the{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-fg">sighash</code>{" "}
            bytes from prepare. The wallet does this for you; Preview and Live both verify 64-byte sigs.
          </Step>
          <Step n={3}>
            Minting stays Preview-only: faucet, mine, and reset are refused on the live proxy and never
            touch the testnet.
          </Step>
          <Step n={4}>
            Clones dial a <strong className="font-medium text-fg">DNS-only</strong> seed host,{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-fg">
              seed.kovanica.online:9000
            </code>{" "}
            — not <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-fg">explorer…</code>{" "}
            (Cloudflare does not proxy raw TCP :9000).
          </Step>
        </ol>

        <div className="mt-5 overflow-hidden rounded-xl border border-border bg-[#0b0c10]">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
            <p className="flex items-center gap-2 font-mono text-[11px] text-white/50">
              <Terminal className="size-3.5" />
              run a public node
            </p>
            <CopyButton text={runNode} />
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-white/80">
            {runNode}
          </pre>
        </div>
      </section>
    </main>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[11px] tracking-widest text-subtle">{kicker}</span>
      <h2 className="font-display text-2xl tracking-tight text-fg">{title}</h2>
      <span className="ml-2 hidden h-px flex-1 bg-border sm:block" />
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="relative pb-4 text-sm leading-relaxed text-muted last:pb-0">
      <span className="absolute top-0 -left-[calc(1.5rem+1px)] flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-bg font-mono text-[10px] text-subtle">
        {n}
      </span>
      {children}
    </li>
  );
}

function EndpointTable({ rows, label }: { rows: Endpoint[]; label: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(path: string) {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(path);
      window.setTimeout(() => setCopied((c) => (c === path ? null : c)), 1200);
    });
  }

  return (
    <div>
      <p className="border-b border-border bg-surface px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
        {label}
      </p>
      <table className="w-full min-w-[520px] text-left text-sm">
        <tbody className="font-mono text-xs">
          {rows.map((r) => (
            <tr key={r.path} className="group border-t border-border first:border-t-0 hover:bg-surface">
              <td className="w-16 px-4 py-2.5 align-top">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    r.method === "GET" ? "bg-blue/10 text-blue" : "bg-accent/15 text-accent"
                  }`}
                >
                  {r.method}
                </span>
              </td>
              <td className="px-2 py-2.5 align-top text-fg">{r.path}</td>
              <td className="py-2.5 pr-2 align-top font-sans text-muted">{r.note}</td>
              <td className="w-8 py-2.5 pr-3 align-top">
                <button
                  type="button"
                  aria-label={`Copy ${r.path}`}
                  onClick={() => copy(r.path)}
                  className="text-subtle opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  {copied === r.path ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        })
      }
      className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {copied ? "copied" : "copy"}
    </button>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="group rounded-xl border border-border bg-surface px-3.5 py-3 transition-colors hover:bg-surface-2">
      <dt className="text-[10px] tracking-wide text-subtle uppercase">{k}</dt>
      <dd className="mt-1 font-mono text-[13px] text-fg">{v}</dd>
    </div>
  );
}

function StatusCard({ title, ok, lines }: { title: string; ok: boolean; lines: string[] }) {
  return (
    <article className="bg-bg p-4 transition-colors hover:bg-surface">
      <p className="flex items-center gap-2 text-sm text-fg">
        <span className={`relative flex size-2 ${ok ? "text-ok" : "text-danger"}`}>
          <span
            className={`absolute inline-flex size-full animate-ping rounded-full opacity-40 ${
              ok ? "bg-ok" : "bg-danger"
            }`}
          />
          <span className={`relative inline-flex size-2 rounded-full ${ok ? "bg-ok" : "bg-danger"}`} />
        </span>
        {title}
      </p>
      {lines.map((l) => (
        <p key={l} className="mt-1 font-mono text-xs text-muted">
          {l}
        </p>
      ))}
    </article>
  );
}
