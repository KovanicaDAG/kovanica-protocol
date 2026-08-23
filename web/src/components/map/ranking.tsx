import { Search } from "lucide-react";
import type { CountryView } from "@/lib/geo/catalog";
import { formatPulses, formatShare } from "@/lib/geo/metrics";
import { totals } from "@/lib/geo/catalog";
import { cn } from "@/lib/utils";

type Props = {
  rows: CountryView[];
  selectedId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (isoNumeric: string) => void;
};

export function Ranking({ rows, selectedId, query, onQuery, onSelect }: Props) {
  const pulsed = rows.filter((r) => r.pulses > 0);
  const total = totals(pulsed);
  const q = query.trim().toLowerCase();
  const sorted = [...pulsed].sort((a, b) => b.pulses - a.pulses);
  const filtered = q
    ? rows
        .filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.iso3.toLowerCase().includes(q) ||
            r.region.toLowerCase().includes(q),
        )
        .sort((a, b) => b.pulses - a.pulses)
    : sorted.slice(0, 16);
  const max = filtered[0]?.pulses || 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="px-5 pt-4 pb-2">
        <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">
          {q ? "Matches" : "Top origins"}
        </p>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Find a country"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            suppressHydrationWarning
            className="h-10 w-full rounded-md bg-surface-2 pr-3 pl-8 text-sm text-fg placeholder:text-subtle outline-none ring-0 focus-visible:shadow-border-hover"
          />
        </label>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted">
            {q ? "No countries match." : "No origin pulses yet. Record yours, or tap the coin on Home."}
          </li>
        ) : (
          filtered.map((row, i) => {
            const active = selectedId === row.isoNumeric;
            const width = Math.max(4, (row.pulses / max) * 100);
            return (
              <li key={row.iso3}>
                <button
                  type="button"
                  onClick={() => onSelect(row.isoNumeric)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150",
                    active ? "bg-surface-2" : "hover:bg-surface-2/70",
                  )}
                >
                  <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-subtle">
                    {q ? sorted.findIndex((r) => r.iso3 === row.iso3) + 1 || "—" : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-fg">{row.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                        {formatPulses(row.pulses)}
                      </span>
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-land">
                      <span
                        className="block h-full rounded-full bg-chloro-2 transition-[width] duration-200 ease-smooth-out"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                  </span>
                  <span className="hidden w-12 shrink-0 text-right font-mono text-xs tabular-nums text-subtle sm:block">
                    {formatShare(row.pulses, total)}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
