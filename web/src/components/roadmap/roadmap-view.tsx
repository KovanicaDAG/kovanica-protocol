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

/** Public KVP-10x labels (see docs/KVP.md). */
const PROTOCOL: Item[] = [
  {
    id: "kvp-101",
    title: "KVP-101 · Multisig (M-of-N P2SH)",
    status: "done",
    blurb: "RFC-001 — threshold redeem scripts, activation gating, node + FFI + web multisig UI.",
  },
  {
    id: "kvp-102",
    title: "KVP-102 · Native multi-asset tokens",
    status: "done",
    blurb: "RFC-002 — multi-asset UTXOs, per-asset conservation, coinbase mint, checkpoint v4.",
    note: "Public token standard name for KVNC-ledger assets (not an ERC-20).",
  },
  {
    id: "kvp-103",
    title: "KVP-103 · Stealth + script v2",
    status: "done",
    blurb: "RFC-003 — one-time keys (ECDH), view tags, bounded script machine (CLTV/CSV/hash-lock).",
  },
  {
    id: "kvp-104",
    title: "KVP-104 · HTLC atomic swaps",
    status: "done",
    blurb: "RFC-004 — hashed time-locked contracts, redeem/refund paths, swap session helpers.",
  },
  {
    id: "kvp-105",
    title: "KVP-105 · Time-lock vault + CSV",
    status: "done",
    blurb: "RFC-005 — check-lock-time-verify / check-sequence-verify vaults, escrow templates, node + FFI helpers.",
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
    title: "Web KVP-102 UX",
    status: "done",
    blurb: "AssetPicker + explorer badges; utxos/history/prepare expose asset_id + balances map.",
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
    id: "token-staking",
    title: "Token staking & sortition",
    status: "next",
    blurb: "Extend the stake registry to native-token assets (KVP-102) so bonds can be denominated in any issued token.",
  },
  {
    id: "asset-http",
    title: "Node HTTP asset_id (KVP-102)",
    status: "done",
    blurb: "asset_id on /api/utxos, /api/history, /api/prepare; balances map + wire KVNC/hex helpers.",
  },
  {
    id: "mainnet",
    title: "Mainnet readiness",
    status: "next",
    blurb: "Ops hardening, seed topology, fee market soak, release docs — see docs/LEGIT-BOARD.md.",
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
          Public view of Kovanica Protocol standards (**KVP-101…105**), client surfaces, and what
          lands next. Full legitimacy checklist:{" "}
          <code className="text-fg/80">docs/LEGIT-BOARD.md</code> (P0–P2).
        </p>
        <p className="mt-3 font-mono text-xs text-subtle">
          {done} shipped ·{" "}
          {PROTOCOL.filter((i) => i.status === "active").length +
            SURFACE.filter((i) => i.status === "active").length}{" "}
          in progress · {NEXT.length} queued · {total} tracked
        </p>
      </header>

      <Section title="KVP consensus standards" items={PROTOCOL} />
      <Section title="Clients & surface" items={SURFACE} />
      <Section title="Next up" items={NEXT} />

      <p className="border-t border-border pt-6 text-xs leading-relaxed text-subtle">
        Token standard: <strong className="text-muted">KVP-102</strong> (native multi-asset; not
        ERC-20). Specs: <code className="text-muted">docs/KVP*.md</code>,{" "}
        <code className="text-muted">docs/WHAT-IS-KOVANICA.md</code>,{" "}
        <code className="text-muted">docs/TOKENOMICS.md</code>.{" "}
        <Link to="/docs" className="text-blue underline-offset-2 hover:underline">
          Technical details
        </Link>{" "}
        cover the HTTP API on testnet.
      </p>
    </main>
  );
}
