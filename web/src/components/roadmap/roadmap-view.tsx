import { Link } from "@tanstack/react-router";
import { Check, Circle, Loader } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "done" | "active" | "next";

type Item = {
  id: string;
  title: string;
  status: Status;
  blurb: string;
  note?: string;
};

const PROTOCOL: Item[] = [
  {
    id: "rfc-001",
    title: "RFC-001 · Multisig (M-of-N P2SH)",
    status: "done",
    blurb: "Threshold redeem scripts, activation gating, node + FFI + web multisig UI.",
  },
  {
    id: "rfc-002",
    title: "RFC-002 · Native tokens",
    status: "done",
    blurb: "Multi-asset UTXOs, per-asset conservation, coinbase mint path, checkpoint v4.",
  },
  {
    id: "rfc-003",
    title: "RFC-003 · Stealth + script v2",
    status: "done",
    blurb: "One-time keys (ECDH), view tags, bounded script machine (CLTV/CSV/hash-lock).",
  },
  {
    id: "rfc-004",
    title: "RFC-004 · HTLC atomic swaps",
    status: "active",
    blurb: "Hashed time-locked contracts, redeem/refund paths, swap session helpers.",
    note: "Implementation on branch; needs rebase onto main after RFC-003 squash.",
  },
];

const SURFACE: Item[] = [
  {
    id: "web-core",
    title: "Web explorer + browser wallet",
    status: "done",
    blurb: "Graph, wallet, multisig, network status, native app download links.",
  },
  {
    id: "web-assets",
    title: "Web multi-asset UX",
    status: "active",
    blurb: "AssetPicker + explorer badges ready; full picker needs node asset_id in HTTP API.",
  },
  {
    id: "android-ios",
    title: "Android APK + iOS IPA",
    status: "done",
    blurb: "CI builds debug APK and unsigned sideload IPA (AltStore / Sideloadly).",
  },
  {
    id: "light-node",
    title: "Mobile light-node + FFI",
    status: "done",
    blurb: "UniFFI bindings, Android light-node slices, SPV/filter path in node.",
  },
];

const NEXT: Item[] = [
  {
    id: "htlc-land",
    title: "Land RFC-004 on main",
    status: "next",
    blurb: "Rebase HTLC branch, green tests, merge; then optional web swap UI.",
  },
  {
    id: "asset-http",
    title: "Node HTTP asset_id",
    status: "next",
    blurb: "Expose asset_id on utxos/history/prepare so the web picker shows real assets.",
  },
  {
    id: "mainnet",
    title: "Mainnet readiness",
    status: "next",
    blurb: "Ops hardening, seed topology, fee market soak, release docs.",
  },
];

function StatusIcon({ status }: { status: Status }) {
  if (status === "done") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
        <Check className="size-4" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
        <Loader className="size-4 animate-spin" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
      <Circle className="size-3.5" strokeWidth={2} aria-hidden />
    </span>
  );
}

function statusLabel(s: Status): string {
  if (s === "done") return "Shipped";
  if (s === "active") return "In progress";
  return "Up next";
}

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <h2 className="font-display text-xl tracking-tight text-fg">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2/80"
          >
            <StatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h3 className="font-medium text-fg">{item.title}</h3>
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-wide",
                    item.status === "done" && "text-ok",
                    item.status === "active" && "text-gold",
                    item.status === "next" && "text-subtle",
                  )}
                >
                  {statusLabel(item.status)}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{item.blurb}</p>
              {item.note ? (
                <p className="mt-1.5 text-xs leading-relaxed text-subtle">{item.note}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RoadmapView() {
  const done = [...PROTOCOL, ...SURFACE].filter((i) => i.status === "done").length;
  const total = PROTOCOL.length + SURFACE.length + NEXT.length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8 md:px-6 md:py-10">
      <header>
        <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">Protocol</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-fg md:text-4xl">Roadmap</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Public view of where Kovanica is: consensus RFCs, client surfaces, and what lands next.
          Status mirrors the monorepo plan in AGENTS.md and the RFC docs.
        </p>
        <p className="mt-3 font-mono text-xs text-subtle">
          {done} shipped · {PROTOCOL.filter((i) => i.status === "active").length +
            SURFACE.filter((i) => i.status === "active").length}{" "}
          in progress · {NEXT.length} queued · {total} tracked
        </p>
      </header>

      <Section title="Consensus upgrades" items={PROTOCOL} />
      <Section title="Clients & surface" items={SURFACE} />
      <Section title="Next up" items={NEXT} />

      <p className="border-t border-border pt-6 text-xs leading-relaxed text-subtle">
        Specs live under <code className="text-muted">docs/RFC-*.md</code> in the protocol repo.{" "}
        <Link to="/docs" className="text-blue underline-offset-2 hover:underline">
          Technical details
        </Link>{" "}
        cover the HTTP API on testnet.
      </p>
    </main>
  );
}
