import { Button } from "@/components/ui/button";
import { NetworkBadge } from "@/components/layout/network-badge";
import { DagMark } from "@/components/brand/dag-mark";
import { SURFACE } from "@/lib/surfaces";

/**
 * Designed "launching soon" shell for mainnet.kovanica.online — gold
 * identity, no app routes, reversible gate (swap for the real app when the
 * mainnet node opens).
 */
export function MainnetLaunching() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6"
        style={{ borderTop: "1px solid #F2A900" }}
      >
        <a href={SURFACE.landing} className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="font-mono text-[10px] tracking-brand text-blue uppercase md:text-xs">
            Protocol
          </span>
        </a>
        <NetworkBadge />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-16">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
          style={{
            background:
              "radial-gradient(ellipse at top, rgba(242,169,0,0.10), transparent 60%)",
          }}
        />
        <div className="relative mx-auto w-full max-w-md text-center">
          <DagMark variant="gold" className="mx-auto size-12" />
          <p className="eyebrow mt-6">kovanica-mainnet · KVNC</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-fg italic md:text-5xl">
            Mainnet is launching soon.
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">
            The production network is being finalized — genesis, node
            distribution and the authority set. Meanwhile the full
            protocol is live on testnet.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild variant="gold" className="h-11 px-6">
              <a href={`${SURFACE.testnet}/explorer`}>Open Testnet Explorer</a>
            </Button>
            <Button asChild variant="outline" className="h-11 px-6">
              <a href={`${SURFACE.testnet}/wallet`}>Open wallet</a>
            </Button>
          </div>
          <p className="mt-6 font-mono text-[10px] tracking-wide text-subtle uppercase">
            mainnet.kovanica.online · GHOSTDAG · Proof-of-Authority
          </p>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-xs text-subtle md:flex-row">
          <span className="font-mono">kovanica-mainnet · KVNC</span>
          <span className="flex items-center gap-4 font-mono">
            <a className="transition-colors hover:text-fg" href={SURFACE.landing}>
              kovanica.online
            </a>
            <a className="transition-colors hover:text-fg" href={SURFACE.testnet}>
              testnet
            </a>
            <a className="transition-colors hover:text-fg" href={SURFACE.docs}>
              docs
            </a>
            <a className="transition-colors hover:text-fg" href={SURFACE.api}>
              api
            </a>
            <a className="transition-colors hover:text-fg" href={SURFACE.dash}>
              dash
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
