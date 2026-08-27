import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export function OriginsChip({ className }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg bg-surface/90 px-3 py-2 shadow-border backdrop-blur-sm",
        className,
      )}
    >
      <p className="text-xs font-medium tracking-wide text-subtle uppercase">Origin pulses</p>
      <p className="mt-0.5 text-sm text-fg">Where taps and visits land</p>
    </div>
  );
}
