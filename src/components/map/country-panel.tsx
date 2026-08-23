import { X } from "lucide-react";
import type { CountryView } from "@/lib/geo/catalog";
import { rankOf, totals } from "@/lib/geo/catalog";
import { formatPulses, formatShare } from "@/lib/geo/metrics";
import { Button } from "@/components/ui/button";
import { OriginDag } from "@/components/map/origin-dag";
import { RegionBars } from "@/components/map/region-bars";
import { cn } from "@/lib/utils";

type Props = {
  rows: CountryView[];
  selected: CountryView | null;
  onClear: () => void;
  className?: string;
};

export function CountryPanel({ rows, selected, onClear, className }: Props) {
  if (!selected) {
    return <GlobalSnapshot rows={rows} className={className} />;
  }

  const pulsed = rows.filter((r) => r.pulses > 0);
  const rank = rankOf(pulsed.length ? pulsed : rows, selected.iso3);
  const total = totals(pulsed);
  const share = formatShare(selected.pulses, total);

  return (
    <section className={cn("flex flex-col gap-4 p-5", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-wide text-subtle uppercase">{selected.region}</p>
          <h2 className="font-display text-2xl leading-tight tracking-tight text-fg lg:text-3xl">
            {selected.name}
          </h2>
          <p className="mt-1 font-mono text-xs text-muted">{selected.iso3}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-10 shrink-0" onClick={onClear} aria-label="Clear selection">
          <X className="size-4" />
        </Button>
      </header>

      <div>
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">Origin pulses</p>
        <p className="mt-1 font-display text-4xl leading-none tabular-nums tracking-tight text-fg">
          {formatPulses(selected.pulses)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {selected.pulses > 0
            ? `Rank ${rank} of ${pulsed.length} · ${share} of recorded pulses`
            : "No pulses from this origin yet"}
        </p>
      </div>

      <OriginDag rows={rows} selected={selected} />

      <p className="text-xs leading-relaxed text-muted">
        {selected.pulses > 0
          ? `${selected.pulses} live ${selected.pulses === 1 ? "pulse" : "pulses"} recorded from ${selected.name}. Each tap on Home and each Record origin adds one.`
          : `Nobody has pulsed ${selected.name} yet. Record origin if that's you.`}
      </p>
    </section>
  );
}

function GlobalSnapshot({
  rows,
  className,
}: {
  rows: CountryView[];
  className?: string;
}) {
  const pulsed = rows.filter((r) => r.pulses > 0);
  const total = totals(pulsed);
  const top = [...pulsed].sort((a, b) => b.pulses - a.pulses)[0];

  return (
    <section className={cn("flex flex-col gap-4 p-5", className)}>
      <header>
        <p className="font-mono text-xs tracking-wide text-subtle uppercase">Worldwide</p>
        <h2 className="font-display text-2xl leading-tight tracking-tight text-fg lg:text-3xl">Origins</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Pulses from coin taps and recorded visits, grouped by inferred country.
        </p>
      </header>
      <div>
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">Origin pulses</p>
        <p className="mt-1 font-display text-4xl leading-none tabular-nums tracking-tight text-fg">
          {formatPulses(total)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Countries" value={String(pulsed.length)} />
        <Stat label="Lead origin" value={top?.name ?? "—"} />
        <Stat label="Median" value={formatPulses(medianOf(pulsed))} />
        <Stat label="Catalog" value={String(rows.length)} />
      </dl>
      <RegionBars rows={pulsed} />
      <p className="text-xs text-subtle">Click a country on the map, or pick one from the list.</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

function medianOf(rows: CountryView[]): number {
  if (rows.length === 0) return 0;
  const vals = rows.map((r) => r.pulses).sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}
