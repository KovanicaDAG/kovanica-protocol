import { Coins } from "lucide-react";
import { TOKEN, assetLabel, isNativeAsset } from "@/lib/api/contract";
import { cn } from "@/lib/utils";

export type AssetOption = {
  /** null = native KVNC */
  assetId: string | null;
  balance: number;
  label?: string;
};

type Props = {
  options: AssetOption[];
  value: string | null;
  onChange: (assetId: string | null) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Select which asset to spend. Native KVNC is always first.
 * When the node only returns native UTXOs, options will be a single entry.
 */
export function AssetPicker({ options, value, onChange, disabled, className }: Props) {
  const list =
    options.length > 0
      ? options
      : [{ assetId: null as string | null, balance: 0, label: TOKEN }];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-[10px] tracking-wide text-subtle uppercase">Asset</p>
      <div className="flex flex-wrap gap-2">
        {list.map((opt) => {
          const id = opt.assetId;
          const selected =
            (isNativeAsset(value) && isNativeAsset(id)) ||
            (!isNativeAsset(value) && value === id);
          const label = opt.label ?? assetLabel(id);
          return (
            <button
              key={id ?? "native"}
              type="button"
              disabled={disabled}
              onClick={() => onChange(isNativeAsset(id) ? null : id)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                selected
                  ? "border-gold/50 bg-gold/10 text-gold"
                  : "border-border bg-surface text-muted hover:text-fg",
                disabled && "opacity-50",
              )}
            >
              <Coins className="size-3.5" />
              <span className="font-mono text-xs">{label}</span>
            </button>
          );
        })}
      </div>
      {!isNativeAsset(value) && (
        <p className="break-all font-mono text-[10px] text-subtle">{value}</p>
      )}
    </div>
  );
}
