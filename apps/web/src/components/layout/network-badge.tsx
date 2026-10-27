import { cn } from "@/lib/utils";
import { getBadgeColor, getBadgeLabel, detectNetwork } from "@/lib/network";

/**
 * Network environment badge. Amber = testnet, green = mainnet — the ONLY
 * places network color may appear as a signal (never on CTAs).
 */
export function NetworkBadge() {
  const isMainnet = detectNetwork() === "mainnet";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] tracking-wide uppercase",
        isMainnet
          ? "bg-net-mainnet-soft text-net-mainnet"
          : "bg-net-testnet-soft text-net-testnet",
      )}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: getBadgeColor() }} />
      {getBadgeLabel()}
    </span>
  );
}
