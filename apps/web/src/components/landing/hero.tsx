/**
 * Landing hero — responsive contrast:
 * - Mobile: stacked, tighter tracking, full-width CTAs
 * - Desktop: large italic title + horizontal CTA row
 */
import { CtaRow } from "./cta-row";

export function Hero() {
  return (
    <section className="flex flex-col items-center text-center">
      <p className="font-mono text-[11px] tracking-brand text-subtle uppercase md:text-xs">
        kovanica · BlockDAG · KVNC
      </p>

      <h1 className="mt-2 font-display text-4xl tracking-tight text-fg italic md:mt-3 md:text-6xl lg:text-7xl">
        Kovanica
      </h1>

      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted md:mt-4 md:max-w-lg md:text-base">
        A BlockDAG you can explore, a wallet you can fund, native multi-asset,
        stealth addresses, HTLC swaps, time-lock vaults — and a clear path to
        mainnet.
      </p>

      {/* CTAs: full-width stack on mobile, row on sm+ */}
      <div className="mt-6 w-full max-w-lg md:mt-8 md:max-w-none">
        <CtaRow />
      </div>
    </section>
  );
}
