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

/** Core Protocol Architecture & Wasmi Smart Contracts. */
const PROTOCOL: Item[] = [
  {
    id: "mysticeti-consensus",
    title: "Mysticeti BlockDAG Consensus",
    status: "done",
    blurb:
      "Uncertified DAG consensus with 3-round commit waves, 4s round intervals, and 12s committed leaders with BFT finality.",
    note: "Round-robin leader progression among active staked validator committee.",
  },
  {
    id: "account-ledger",
    title: "Account-Based Ledger & PRO-21 Addresses",
    status: "done",
    blurb:
      "Account-based state model with sequence nonces and canonical PRO-21 addresses (64 chars: kvnc + 57 base32 + dag).",
    note: "BLAKE3 KUNA-TX-v1 sighashes signed client-side with Ed25519 keys.",
  },
  {
    id: "wasmi-runtime",
    title: "Wasmi Deterministic Execution Runtime",
    status: "done",
    blurb:
      "Sandboxed WebAssembly runtime for deterministic smart contract execution, gas metering, and host storage interop.",
  },
  {
    id: "contract-multisig",
    title: "Multisig Contract (kovanica-multisig)",
    status: "done",
    blurb:
      "M-of-N threshold multi-signature Wasmi smart contract supporting partial signature aggregation and activation gating.",
  },
  {
    id: "contract-htlc",
    title: "HTLC Atomic Swaps (kovanica-htlc)",
    status: "done",
    blurb:
      "Hashed time-locked Wasmi smart contract for trustless cross-chain atomic swaps and conditional escrow release.",
  },
  {
    id: "contract-vault",
    title: "Time-Lock Vaults & Vesting (kovanica-vault)",
    status: "done",
    blurb:
      "Deterministic time-lock vault contract supporting linear treasury vesting schedules and revocable time locks.",
  },
  {
    id: "contract-token",
    title: "Fungible Token Standard (kovanica-token)",
    status: "done",
    blurb:
      "CW20-style deterministic WASM token contract with minting, transfers, allowances, and burn capabilities.",
  },
];

const SURFACE: Item[] = [
  {
    id: "web-explorer",
    title: "Multi-Lane BlockDAG Explorer",
    status: "done",
    blurb:
      "5-validator committee lanes visualizing BFT leader progression, interactive DAG canvas, zoom controls, and 18 live network metrics.",
  },
  {
    id: "web-wallet",
    title: "Web Wallet & Signer",
    status: "done",
    blurb:
      "Client-side wallet supporting BIP-39 mnemonic derivation, PRO-21 address generation, and in-browser transaction signing.",
  },
  {
    id: "web-faucet",
    title: "Testnet Faucet",
    status: "done",
    blurb:
      "Automated testnet faucet dispensing 10 KUNA with rate limiting and canonical PRO-21 address verification.",
  },
  {
    id: "cli-tooling",
    title: "Node CLI & Tooling (kovanica-cli)",
    status: "done",
    blurb:
      "Full command-line toolkit for node administration, key generation, RPC inspection, and genesis orchestration.",
  },
];

const SDK: Item[] = [
  {
    id: "rust-crates",
    title: "Rust Workspace Crates",
    status: "done",
    blurb:
      "27 modular crates: kovanica-types, kovanica-crypto, kovanica-dag, kovanica-consensus, kovanica-mempool, kovanica-network, kovanica-runtime, kovanica-staking, kovanica-node, kovanica-rpc.",
  },
  {
    id: "ts-packages",
    title: "TypeScript SDK Packages",
    status: "done",
    blurb:
      "Modular client libraries: @kovanica/api-client, @kovanica/signer, @kovanica/console, and @kovanica/web.",
  },
  {
    id: "sdk-wasm",
    title: "WASM In-Browser Engine",
    status: "done",
    blurb:
      "Wasm-bindgen client engine for in-browser transaction preparation, BLAKE3 sighash derivation, and zero-knowledge seed protection.",
  },
  {
    id: "json-rpc",
    title: "JSON-RPC 2.0 Interface",
    status: "done",
    blurb:
      "Node-parity RPC endpoints for syncStatus, getLeaderHeader, getBalance, getNonce, sendRawTransaction, and getValidators.",
  },
];

const NEXT: Item[] = [
  {
    id: "staking-lifecycle",
    title: "Validator Lifecycle & Active Set Expansion",
    status: "active",
    blurb:
      "Expanding active validator committee from 5 to 15–21 staked nodes, dynamic bond/unbond lifecycle, and commission distribution.",
  },
  {
    id: "node-hardening",
    title: "P2P Network & State Snapshot Hardening",
    status: "active",
    blurb:
      "Fast snapshot sync, DAG block payload pruning, multi-seed peer discovery, and catch-up validation under network turbulence.",
  },
  {
    id: "contract-abi",
    title: "Contract UX & Typed ABI Pipeline",
    status: "next",
    blurb:
      "Typed ABI code-generation, extended Wasmi gas metering tables, and streamlined contract deployment workflows.",
  },
  {
    id: "observability-indexer",
    title: "Observability & Real-Time Indexer Hooks",
    status: "next",
    blurb:
      "Committed subdag execution hooks, Prometheus metrics, structured tracing, and WebSocket event feeds.",
  },
  {
    id: "mainnet-readiness",
    title: "Mainnet Launch Readiness",
    status: "next",
    blurb:
      "15–20 genesis validator bootstrap (1M KUNA genesis allocation), 8.1M halving era schedule, and security audit sign-off.",
  },
];

function StatusIcon({ status }: { status: Status }) {
  if (status === "done") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Check className="size-4" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
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
                    item.status === "done" && "text-emerald-400 font-semibold",
                    item.status === "active" && "text-amber-400 font-semibold",
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
  const done = [...PROTOCOL, ...SURFACE, ...SDK].filter((i) => i.status === "done").length;
  const inProgress = NEXT.filter((i) => i.status === "active").length;
  const queued = NEXT.filter((i) => i.status === "next").length;
  const total = PROTOCOL.length + SURFACE.length + SDK.length + NEXT.length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8 md:px-6 md:py-10">
      <header>
        <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">Protocol</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-fg md:text-4xl">Roadmap</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Development roadmap and architecture milestones for the Kovanica Layer-1 blockchain, core crates, Wasmi smart contracts, and mainnet launch focus areas.
        </p>
        <p className="mt-3 font-mono text-xs text-subtle">
          <strong className="text-emerald-400">{done} shipped</strong> ·{" "}
          <strong className="text-amber-400">{inProgress} in progress</strong> ·{" "}
          <span>{queued} queued</span> · {total} tracked milestones
        </p>
      </header>

      <Section title="Consensus & Wasmi Smart Contracts" items={PROTOCOL} />
      <Section title="Client Applications & Explorer" items={SURFACE} />
      <Section title="SDK & Developer Tooling" items={SDK} />
      <Section title="Next Focus Areas (Mainnet Roadmap)" items={NEXT} />

      <div className="rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted space-y-2">
        <p>
          <strong className="text-fg">Consensus:</strong> Mysticeti uncertified DAG (wave = 3, 4s round → 12s leader commit).
        </p>
        <p>
          <strong className="text-fg">Execution:</strong> Deterministic Wasmi WebAssembly runtime.
        </p>
        <p>
          <strong className="text-fg">Tokenomics:</strong> Native token <strong className="text-fg">KUNA</strong> (9 decimals, 90,200,000 hard cap, 81M mining subsidy budget, 2.5 KUNA leader reward).
        </p>
        <p className="border-t border-border/60 pt-2 text-subtle">
          More details available in the{" "}
          <Link to="/docs" className="text-amber-400 underline-offset-2 hover:underline">
            Documentation
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
