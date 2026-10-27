import { NetworkBadge } from "@/components/layout/network-badge";
import { SURFACE } from "@/lib/surfaces";
import { getBadgeColor } from "@/lib/network";

/**
 * Focused-surface header: wordmark + network badge + one back link.
 * Used by faucet and api-reference so those pages stay single-purpose.
 */
export function MinimalHeader({
  backTo,
  backLabel = "Back",
}: {
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <header
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:px-6"
      style={{ borderTop: `1px solid ${getBadgeColor()}` }}
    >
      <a href={SURFACE.landing} className="flex min-w-0 items-baseline gap-2">
        <span className="font-display text-xl tracking-tight text-fg italic">Kovanica</span>
        <span className="font-mono text-[10px] tracking-brand text-blue uppercase">Protocol</span>
      </a>
      <div className="flex items-center gap-3">
        {backTo ? (
          <a
            href={backTo}
            className="hidden font-mono text-[11px] tracking-wide text-muted uppercase transition-colors hover:text-fg sm:block"
          >
            {backLabel}
          </a>
        ) : null}
        <NetworkBadge />
      </div>
    </header>
  );
}
