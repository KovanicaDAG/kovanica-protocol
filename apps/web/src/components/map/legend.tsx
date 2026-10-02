import { formatPulses } from "@/lib/geo/metrics";
import type { ColorScale } from "@/lib/geo/scale";
import { cn } from "@/lib/utils";

type Props = {
  scale: ColorScale;
  className?: string;
};

export function ChoroplethLegend({ scale, className }: Props) {
  const { breaks, stops } = scale;
  const labels = [formatPulses(0), ...breaks.map((b) => formatPulses(b))];

  return (
    <div className={cn("rounded-lg bg-surface/90 px-3 py-2.5 shadow-border backdrop-blur-sm", className)}>
      <p className="mb-1.5 text-xs font-medium tracking-wide text-subtle uppercase">Pulses</p>
      <div className="flex h-2 overflow-hidden rounded-full">
        {stops.map((c) => (
          <span key={c} className="h-full flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between gap-2 font-mono text-xs tabular-nums text-muted">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1] === labels[0] ? "High" : labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}
