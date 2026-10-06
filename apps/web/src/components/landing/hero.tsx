import { CtaRow } from "./cta-row";
import { LiveStats } from "./live-stats";

/**
 * Apex landing hero — black + gold identity.
 * Gold radial glow behind, gradient tagline in Fraunces italic,
 * and a live testnet strip under the CTAs.
 */
export function Hero() {
  return (
    <section className="relative flex flex-col items-center overflow-hidden text-center">
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-80"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(242,169,0,0.10), transparent 60%)",
        }}
        aria-hidden
      />
      <div className="relative flex w-full flex-col items-center">
        <p className="font-mono text-[11px] tracking-brand text-gold uppercase md:text-xs">
          kovanica · BlockDAG · KVNC
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight text-fg italic md:mt-3 md:text-6xl lg:text-7xl">
          Kovanica
        </h1>
        <p className="mt-1 bg-gradient-to-r from-gold via-gold-dark to-gold bg-clip-text font-display text-xl tracking-tight text-transparent italic md:text-2xl">
          BlockDAG, wide open.
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted md:mt-4 md:max-w-lg md:text-base">
          A BlockDAG you can explore, a wallet you can fund, native
          multi-asset, stealth addresses, HTLC swaps, time-lock vaults — and a
          clear path to mainnet.
        </p>
        <div className="mt-6 w-full max-w-lg md:mt-8 md:max-w-none">
          <CtaRow />
        </div>
        <div className="mt-8 w-full max-w-lg md:mt-10 md:max-w-xl">
          <LiveStats />
        </div>
      </div>
    </section>
  );
}