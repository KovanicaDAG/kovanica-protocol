import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

function DocsPage() {
  return (
    <Shell>
      <DocsBody />
    </Shell>
  );
}

const ROWS = [
  { method: "GET", path: "/api/head", note: "genesis, tip, height" },
  { method: "GET", path: "/api/bootstrap", note: "plus listen, peers, upstream probe" },
  { method: "GET", path: "/api/p2p", note: "TCP listen + bootstrap peers" },
  { method: "GET", path: "/api/blocks", note: "octet-stream dump (clone catch-up)" },
  { method: "GET", path: "/api/state", note: "full DAG + flags" },
  { method: "GET", path: "/api/utxos?address=", note: "spendable outputs" },
  { method: "GET", path: "/api/history?address=", note: "deltas per address" },
  { method: "GET", path: "/api/origins", note: "ISO3 pulses" },
  { method: "POST", path: "/api/prepare", note: "sighash + fee + change" },
  { method: "POST", path: "/api/submit", note: "queue signed tx" },
  { method: "POST", path: "/api/produce", note: "pack mempool" },
  { method: "POST", path: "/api/mine", note: "preview coinbase block" },
  { method: "POST", path: "/api/faucet", note: "preview mint; live disabled" },
  { method: "POST", path: "/api/origin", note: "pulse a country" },
  { method: "GET", path: "/api/spec", note: "this document, text/plain" },
];

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">{NETWORK_ID}</p>
          <h1 className="font-display text-3xl tracking-tight text-fg md:text-4xl">Technical details</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            HTTP API that matches the public explorer. Preview is this app. Live proxies{" "}
            <a className="text-fg underline-offset-2 hover:underline" href={LIVE_EXPLORER}>
              explorer.kovanica.online
            </a>
            .
          </p>
        </div>
        <SourceSwitch />
      </header>

      <section className="grid gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-2">
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
      </section>

      <section>
        <h2 className="font-display text-xl tracking-tight text-fg">Chain</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <Fact k="Token" v="KVNC · 8 decimals" />
          <Fact k="Atom" v={`${ATOM.toLocaleString()} / KVNC`} />
          <Fact k="Subsidy" v={`${SUBSIDY / ATOM} KVNC, half / ${HALVING_ERA}`} />
          <Fact k="Min fee" v={`${MIN_FEE} atoms (burned)`} />
          <Fact k="GHOSTDAG k" v={String(K)} />
          <Fact k="P2P" v="TCP :9000 · seed.kovanica.online:9000" />
        </dl>
      </section>

      <section>
        <h2 className="font-display text-xl tracking-tight text-fg">Endpoints</h2>
        <p className="mt-1 text-sm text-muted">
          Same paths as the live explorer. Add <code className="font-mono text-fg">?source=live</code> to proxy.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Method</th>
                <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Path</th>
                <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {ROWS.map((r) => (
                <tr key={r.path} className="border-t border-border">
                  <td className="px-4 py-2.5 text-blue">{r.method}</td>
                  <td className="px-4 py-2.5 text-fg">{r.path}</td>
                  <td className="px-4 py-2.5 font-sans text-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          Plain spec:{" "}
          <a className="text-fg underline-offset-2 hover:underline" href="/api/spec">
            /api/spec
          </a>
          . Wallet signs in the browser; the node never sees the seed.
        </p>
      </section>

      <section>
        <h2 className="font-display text-xl tracking-tight text-fg">Going live</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Flip the header to Live — reads already hit the public node through this app.</li>
          <li>
            Sends need an Ed25519 signature (128 hex) over the <code className="font-mono text-fg">sighash</code> bytes
            from prepare. The wallet does this for you. Preview and Live both verify 64-byte sigs.
          </li>
          <li>Faucet, tap-mint, reset, and empty-block mining stay off on the public explorer.</li>
          <li>
            Seed node: listen on TCP 9000, set <code className="font-mono text-fg">KOVANICA_PEERS=off</code> so it does
            not dial itself. Clones must dial a <strong className="text-fg">DNS-only</strong> hostname or the origin
            IP — not <code className="font-mono text-fg">explorer.kovanica.online:9000</code> (Cloudflare does not
            proxy 9000). Use <code className="font-mono text-fg">seed.kovanica.online:9000</code> once that A record
            exists (grey cloud).
          </li>
        </ol>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-muted whitespace-pre-wrap">
          {runNode}
        </pre>
      </section>
    </main>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <dt className="text-[10px] tracking-wide text-subtle uppercase">{k}</dt>
      <dd className="mt-1 text-fg">{v}</dd>
    </div>
  );
}

function StatusCard({ title, ok, lines }: { title: string; ok: boolean; lines: string[] }) {
  return (
    <article className="bg-bg p-4">
      <p className="flex items-center gap-2 text-sm text-fg">
        <span className={ok ? "text-ok" : "text-danger"}>●</span>
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
