import type { CountryView } from "@/lib/geo/catalog";
import { formatPulses } from "@/lib/geo/metrics";
import { totals } from "@/lib/geo/catalog";

const ORDER = ["Europe", "Americas", "Asia-Pacific", "Middle East & Africa"] as const;

type Props = {
  rows: CountryView[];
};

export function RegionBars({ rows }: Props) {
  const grouped = ORDER.map((region) => {
    const subset = rows.filter((r) => r.region === region);
    return { region, value: totals(subset), count: subset.length };
  }).filter((g) => g.count > 0);

  const max = Math.max(...grouped.map((g) => g.value), 1);

  return (
    <ul className="flex flex-col gap-2">
      {grouped.map((g) => (
        <li key={g.region}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-muted">{g.region}</span>
            <span className="font-mono text-xs tabular-nums text-fg">
              {formatPulses(g.value)}
            </span>
          </div>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-land">
            <span
              className="block h-full rounded-full bg-chloro-2 transition-[width] duration-200 ease-smooth-out"
              style={{ width: `${Math.max(6, (g.value / max) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
