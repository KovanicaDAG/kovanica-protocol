import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { SourceSwitch } from "@/components/layout/source-switch";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { ATOM, HALVING_ERA, K, MAX_SUPPLY, MIN_FEE, SUBSIDY, type ApiBootstrap } from "@/lib/api/contract";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { getCurrentSpecText, getNetworkId } from "@/lib/network";
import { SURFACE } from "@/lib/surfaces";

export const Route = createFileRoute("/docs")({ component: DocsPage });

const SECTIONS = [
  { id: "getting-started", label: "Getting started" },
  { id: "wallet", label: "Wallet" },
  { id: "sdk", label: "SDK" },
  { id: "tokens", label: "Tokens · NFT · RWA" },
  { id: "staking", label: "Staking" },
  { id: "protocol", label: "Protocol" },
  { id: "tokenomics", label: "Tokenomics" },
  { id: "node-ops", label: "Node operations" },
  { id: "api-reference", label: "API reference" },
  { id: "roadmap", label: "Roadmap & RFCs" },
];

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
  const runNode = getCurrentSpecText().split("## Run a public node")[1]?.trim() ?? "";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8 md:px-6">
      {/* Sticky sidebar */}
      <aside className="hidden w-52 shrink-0 lg:block">
        <nav className="sticky top-20 flex flex-col gap-0.5" aria-label="Docs sections">
          <p className="eyebrow mb-2">Sections</p>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-md px-2.5 py-1.5 font-mono text-[11px] tracking-wide text-muted uppercase transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {s.label}
            </a>
          ))}
          <div className="mt-4 border-t border-border pt-3">
            <a
              href={SURFACE.api}
              className="rounded-md px-2.5 py-1.5 font-mono text-[11px] tracking-wide text-blue uppercase transition-colors hover:bg-surface-2 hover:text-fg"
            >
              api.kovanica.online →
            </a>
          </div>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile section chips */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted uppercase transition-colors hover:text-fg"
            >
              {s.label}
            </a>
          ))}
        </div>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{getNetworkId()}</p>
            <h1 className="font-display text-3xl tracking-tight text-fg md:text-4xl">
              Documentation
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Getting started, wallet, protocol, node operations and the API contract for the
              Kovanica BlockDAG.
            </p>
          </div>
          <SourceSwitch />
        </header>

        <section className="mt-6 overflow-hidden rounded-xl border border-border">
          <StatusCard
            title="Testnet"
            ok={up?.ok === true}
            lines={
              up?.ok
                ? [
                    `${up.head.blocks} blocks · ${up.head.network}`,
                    `genesis ${up.head.genesis.slice(0, 8)}`,
                  ]
                : [up?.error ?? err ?? "probing…", `P2P :9000 · ${getNetworkId()}`]
            }
          />
        </section>

        {/* Getting started */}
        <section id="getting-started" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Getting started</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Kovanica is a BlockDAG Layer-1: blocks reference multiple parents, GHOSTDAG (k=3) orders
            them, and the selected chain is the anchor of truth. The native token is{" "}
            <strong className="text-fg">KVNC</strong> (8 decimals). Testnet is live; mainnet is
            planned.
          </p>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Get testnet KVNC from the{" "}
              <a className="text-fg underline-offset-2 hover:underline" href={`${SURFACE.testnet}/faucet`}>
                faucet
              </a>{" "}
              (5 KVNC lifetime cap per address).
            </li>
            <li>
              Create or import a wallet on{" "}
              <a
                className="text-fg underline-offset-2 hover:underline"
                href={`${SURFACE.testnet}/wallet`}
              >
                testnet.kovanica.online/wallet
              </a>
              .
            </li>
            <li>
              Send your first transaction — the browser signs Ed25519 sighashes; the node never sees
              the seed.
            </li>
            <li>
              Watch the DAG grow on the{" "}
              <a
                className="text-fg underline-offset-2 hover:underline"
                href={`${SURFACE.testnet}/explorer`}
              >
                explorer
              </a>
              .
            </li>
          </ol>
        </section>

        {/* Wallet */}
        <section id="wallet" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Wallet</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Fact k="Addresses" v="Ed25519 public key (64 hex) or kvnc…dag (versioned + base58)" />
            <Fact k="Derivation" v="SLIP-0010 m/44'/3007'/0'/0'/i' (frozen, coin type 3007)" />
            <Fact k="Signing" v="In the browser — submit never receives the mnemonic" />
            <Fact k="Hardware" v="Ledger (WebHID) + Trezor (WebUSB)" />
          </dl>
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            <li>
              <strong className="text-fg">Multi-asset</strong> — native second-layer assets in the
              same UTXO model (KVP-102).
            </li>
            <li>
              <strong className="text-fg">Stealth</strong> — one-time ECDH addresses with view tags
              (KVP-103 / RFC-003).
            </li>
            <li>
              <strong className="text-fg">HTLC</strong> — hashed time-locked contracts for atomic
              swaps (KVP-104).
            </li>
            <li>
              <strong className="text-fg">Vaults</strong> — CLTV/CSV time-lock vaults and treasury
              vesting (KVP-105).
            </li>
            <li>
              <strong className="text-fg">Multisig</strong> — M-of-N P2SH addresses with partial
              signatures (RFC-001).
            </li>
            <li>
              <strong className="text-fg">NFT / RWA</strong> — KVP-106 draft NFTs with collections,
              and the RWA issuance flow (see below).
            </li>
          </ul>
        </section>

        {/* SDK */}
        <section id="sdk" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">SDK</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            <strong className="text-fg">kovanica-sdk</strong> is the official Rust (+ WASM) SDK for
            the protocol — typed domain models, offline builders, and a node-parity RPC client. It
            ships as six crates (<code className="font-mono text-fg">types</code>,{" "}
            <code className="font-mono text-fg">keys</code>,{" "}
            <code className="font-mono text-fg">tx</code>,{" "}
            <code className="font-mono text-fg">rpc</code>,{" "}
            <code className="font-mono text-fg">fee</code>,{" "}
            <code className="font-mono text-fg">sdk</code>) plus a wasm-bindgen surface for
            browsers.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Fact
              k="Derivation"
              v="SLIP-0010 m/44'/3007'/0'/0'/i' — frozen, shared test vectors with the node"
            />
            <Fact
              k="Sighash"
              v="BLAKE3 over witness-free encoding; byte-identical to kovanica-state"
            />
            <Fact k="Builders" v="TransferBuilder, HtlcBuilder, VaultBuilder, MultisigSigner" />
            <Fact k="RPC" v="GET /api/utxos · GET /api/fee_estimate · POST /api/submit_tx" />
          </dl>
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            <li>
              <strong className="text-fg">Cookbook</strong> — practical recipes (build → estimate →
              sign → submit, multi-asset, HTLC, vaults, multisig, live API, safety):{" "}
              <a
                className="text-fg underline-offset-2 hover:underline"
                href="https://github.com/KovanicaDAG/kovanica-protocol/tree/main/sdk/COOKBOOK.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                sdk/COOKBOOK.md
              </a>
              .
            </li>
            <li>
              <strong className="text-fg">WASM</strong> —{" "}
              <code className="font-mono text-fg">build_signed_transfer</code> runs the whole
              prepare→sign→submit flow in the browser; keys never leave the page.
            </li>
            <li>
              <strong className="text-fg">Live testnet tests</strong> — read-only integration tests
              against the public API, gated behind the{" "}
              <code className="font-mono text-fg">live-testnet</code> feature.
            </li>
          </ul>
        </section>

        {/* Tokens · NFT · RWA */}
        <section id="tokens" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Tokens · NFT · RWA</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Everything non-native lives in the same UTXO ledger as KVNC (KVP-102). Fungible tokens,
            NFTs and RWA all conserve per-asset and pay fees in KVNC only.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Fact
              k="Fungible (KVP-102)"
              v="Native second-layer assets, per-asset conservation, coinbase mint"
            />
            <Fact
              k="NFT (KVP-106)"
              v="Draft — 1-unit assets, collections, IPFS metadata hash on-ledger"
            />
            <Fact
              k="RWA"
              v="Issue flow: derive asset id → IPFS metadata → mint; explorer detail view"
            />
            <Fact
              k="Discovery"
              v="Wallet asset picker lists every held token; NFT detail links to its collection"
            />
          </dl>
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            <li>
              <strong className="text-fg">NFT detail</strong> —{" "}
              <code className="font-mono text-fg">/wallet/nft/{"{assetId}"}</code> shows metadata,
              collection and owner;{" "}
              <code className="font-mono text-fg">/wallet/collection/{"{id}"}</code> lists a
              collection's assets.
            </li>
            <li>
              <strong className="text-fg">RWA issuance</strong> —{" "}
              <a
                className="text-fg underline-offset-2 hover:underline"
                href={`${SURFACE.testnet}/wallet/rwa-issue`}
              >
                testnet.kovanica.online/wallet/rwa-issue
              </a>{" "}
              walks derive → mint → success with asset classes (RE, BOND, INVOICE, COMMODITY, FUND,
              OTHER).
            </li>
            <li>
              <strong className="text-fg">Node API</strong> —{" "}
              <code className="font-mono text-fg">/api/nft/{"{id}"}</code>,{" "}
              <code className="font-mono text-fg">/api/collection/{"{id}"}</code>,{" "}
              <code className="font-mono text-fg">/api/rwa/{"{id}"}</code>.
            </li>
          </ul>
        </section>

        {/* Authority set */}
        <section id="staking" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Authority Set</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Block production is Proof-of-Authority: a fixed set of Ed25519 authorities take turns
            producing blocks in slot round-robin order. The set is represented on-chain as a single
            live Authority UTXO and updated via threshold-signed transactions.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Fact k="Slot duration" v="3000 ms" />
            <Fact k="Finality" v="100 blue score" />
            <Fact k="Update threshold" v="2-of-3 (minimum)" />
            <Fact k="Max authorities" v="16" />
          </dl>
        </section>

        {/* Protocol */}
        <section id="protocol" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Protocol</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <Fact k="Token" v="KVNC · 8 decimals" />
            <Fact k="Atom" v={`${ATOM.toLocaleString()} / KVNC`} />
            <Fact
              k="Subsidy"
              v={`${SUBSIDY / ATOM} KVNC, era / ${HALVING_ERA.toLocaleString()} blocks`}
            />
            <Fact k="Min fee" v={`${MIN_FEE} atoms/byte floor (75% burned)`} />
            <Fact k="GHOSTDAG k" v={String(K)} />
            <Fact k="P2P" v="TCP :9000 · seed.kovanica.online:9000" />
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Block production is Proof-of-Authority: a fixed set of Ed25519 authorities take turns
            producing blocks in slot round-robin order. Finality settles at 100 blue score; payloads
            prune at 1000.
          </p>
        </section>

        {/* Tokenomics (RFC-006) */}
        <section id="tokenomics" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Tokenomics</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            RFC-006 emission is live on testnet: a smooth geometric-decay curve under a hard cap,
            with coinbase maturity and fee burning enforced as consensus rules.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <Fact k="Hard cap" v={`${(MAX_SUPPLY / ATOM).toLocaleString()} KVNC (90.2M)`} />
            <Fact k="Curve emission" v="80M KVNC · geometric decay" />
            <Fact k="Founder premine" v="0.2M KVNC" />
            <Fact k="Treasury" v="10M KVNC (10 × 1M vaults)" />
            <Fact k="Subsidy s₀" v={`${SUBSIDY / ATOM} KVNC / block`} />
            <Fact k="Era" v={`${HALVING_ERA.toLocaleString()} blocks · decay ×¾`} />
            <Fact k="Coinbase maturity" v="100 blocks" />
            <Fact k="Fee split" v="75% burned · 25% producer" />
            <Fact k="Fee floor" v={`${MIN_FEE} atoms/byte (max(1, subsidy/500k))`} />
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Immature coinbases are skipped by the transaction builder; the 90.2M cap, 100-block
            maturity, and fee-burn are hard consensus rules. Full spec:{" "}
            <a
              className="text-fg underline-offset-2 hover:underline"
              href="https://github.com/KovanicaDAG/kovanica/blob/main/protocol/docs/TOKENOMICS.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              protocol/docs/TOKENOMICS.md
            </a>
            .
          </p>
        </section>

        {/* Node operations */}
        <section id="node-ops" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Node operations</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>Reads already hit the public testnet node through this app.</li>
            <li>
              Sends need an Ed25519 signature (128 hex) over the{" "}
              <code className="font-mono text-fg">sighash</code> bytes from prepare. The wallet does
              this for you. All nodes verify 64-byte sigs.
            </li>
            <li>Reset stays off on the public explorer.</li>
            <li>
              Seed node: listen on TCP 9000, set{" "}
              <code className="font-mono text-fg">KOVANICA_PEERS=off</code> so it does not dial
              itself. Clones must dial a <strong className="text-fg">DNS-only</strong> hostname or
              the origin IP — not{" "}
              <code className="font-mono text-fg">explorer.kovanica.online:9000</code> (Cloudflare
              does not proxy 9000). Use{" "}
              <code className="font-mono text-fg">seed.kovanica.online:9000</code> once that A
              record exists (grey cloud).
            </li>
          </ol>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-muted whitespace-pre-wrap">
            {runNode}
          </pre>
          <p className="mt-3 text-sm text-muted">
            Binaries and installer:{" "}
            <a className="text-fg underline-offset-2 hover:underline" href="/download/install.sh">
              install.sh
            </a>{" "}
            ·{" "}
            <a
              className="text-fg underline-offset-2 hover:underline"
              href="/download/kovanica-node-linux-x64"
            >
              linux-x64
            </a>{" "}
            ·{" "}
            <a
              className="text-fg underline-offset-2 hover:underline"
              href="/download/kovanica-node-linux-arm64"
            >
              linux-arm64
            </a>{" "}
            ·{" "}
            <a
              className="text-fg underline-offset-2 hover:underline"
              href="https://github.com/KovanicaDAG/kovanica/blob/main/protocol/docs/RUN-A-NODE.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              full run-a-node guide
            </a>
          </p>
        </section>

        {/* API reference */}
        <section id="api-reference" className="mt-10 scroll-mt-20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl tracking-tight text-fg">API reference</h2>
              <p className="mt-2 max-w-xl text-sm text-muted">
                The full reference — upstream status, every endpoint, and a read-only playground —
                lives on{" "}
                <a className="text-fg underline-offset-2 hover:underline" href={SURFACE.api}>
                  api.kovanica.online
                </a>
                . The table below is the same contract, proxied server-side (CORS is closed on the
                node).
              </p>
            </div>
            <Button asChild size="sm">
              <a href={SURFACE.api}>Open api.kovanica.online</a>
            </Button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
                    Method
                  </th>
                  <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
                    Path
                  </th>
                  <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {ENDPOINTS.map((r) => (
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

        {/* Roadmap */}
        <section id="roadmap" className="mt-10 scroll-mt-20">
          <h2 className="font-display text-2xl tracking-tight text-fg">Roadmap & RFCs</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            RFC status, the KVP index (102 multi-asset, 103 stealth, 104 HTLC, 105 vaults, 106 NFT
            draft) and what ships next on the protocol live on the roadmap.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/roadmap">Open roadmap</Link>
          </Button>
        </section>
      </div>
    </div>
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
