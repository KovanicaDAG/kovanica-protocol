import { useState } from "react";
import { Coins, Copy, Check, Hash } from "lucide-react";
import { toast } from "sonner";
import { assetLabel, isNativeAsset, TOKEN } from "@/lib/api/contract";
import { cn } from "@/lib/utils";

type Size = "sm" | "md";

type Props = {
  assetId?: string | null;
  /** Override displayed text (e.g. legend "token") */
  label?: string;
  /** Force non-native styling even without a real id */
  variant?: "native" | "token" | "auto";
  /** Show full hex under the chip on non-native */
  showFullId?: boolean;
  /** Allow click-to-copy of asset id */
  copyable?: boolean;
  size?: Size;
  className?: string;
};

/**
 * RFC-002 asset chip used in explorer (and reusable elsewhere).
 * Native KVNC is gold-accented; other assets use teal with a hash icon.
 */
export function AssetBadge({
  assetId,
  label: labelOverride,
  variant = "auto",
  showFullId = false,
  copyable = true,
  size = "sm",
  className,
}: Props) {
  const native =
    variant === "native" ? true : variant === "token" ? false : isNativeAsset(assetId);
  const label = labelOverride ?? (native ? TOKEN : assetLabel(assetId));
  const full = native ? null : (assetId && !isNativeAsset(assetId) ? assetId : null);
  const [copied, setCopied] = useState(false);

  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!full || !copyable) return;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      toast.success("Asset id copied");
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <span className={cn("inline-flex max-w-full flex-col gap-0.5", className)}>
      <button
        type="button"
        disabled={native || !copyable || !full}
        onClick={onCopy}
        title={full ?? `${TOKEN} · native`}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-full border font-mono font-medium transition-colors",
          size === "sm" && "h-5 px-1.5 text-[10px]",
          size === "md" && "h-6 px-2 text-[11px]",
          native
            ? "border-gold/30 bg-gold/10 text-gold"
            : "border-teal/35 bg-teal/10 text-teal hover:bg-teal/15",
          !native && copyable && full && "cursor-pointer",
          (native || !copyable || !full) && "cursor-default",
        )}
      >
        {native ? (
          <Coins className={cn(size === "sm" ? "size-2.5" : "size-3")} strokeWidth={2.2} />
        ) : (
          <Hash className={cn(size === "sm" ? "size-2.5" : "size-3")} strokeWidth={2.2} />
        )}
        <span className="truncate">{label}</span>
        {!native && copyable && full && (
          <span className="ml-0.5 opacity-70">
            {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
          </span>
        )}
      </button>
      {showFullId && full && (
        <span className="break-all font-mono text-[9px] leading-tight text-subtle">{full}</span>
      )}
    </span>
  );
}

/** Compact output row: value · badge · owner */
export function AssetOutputRow({
  value,
  assetId,
  owner,
  formatValue,
  shortOwner,
}: {
  value: number;
  assetId?: string | null;
  owner: string;
  formatValue: (n: number) => string;
  shortOwner: (s: string) => string;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border/50 bg-bg/40 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs tabular-nums text-fg">{formatValue(value)}</span>
        <AssetBadge assetId={assetId} size="sm" />
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-subtle">
        <span className="uppercase tracking-wide">to</span>
        <span className="truncate font-mono text-muted" title={owner}>
          {shortOwner(owner)}
        </span>
      </div>
    </li>
  );
}
