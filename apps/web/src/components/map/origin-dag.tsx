import { ChevronRight } from "lucide-react";
import type { CountryView } from "@/lib/geo/catalog";
import { totals } from "@/lib/geo/catalog";
import { formatPulses } from "@/lib/geo/metrics";
import { cn } from "@/lib/utils";

type Props = {
  rows: CountryView[];
  selected: CountryView;
};

export function OriginDag({ rows, selected }: Props) {
  const world = totals(rows.filter((r) => r.pulses > 0));
  const region = totals(rows.filter((r) => r.region === selected.region && r.pulses > 0));
  const nodes = [
    { key: "world", label: "World", value: world, active: false },
    { key: "region", label: selected.region, value: region, active: false },
    { key: "country", label: selected.name, value: selected.pulses, active: true },
  ];

  return (
    <div>
      <p className="mb-2 font-mono text-xs tracking-wide text-subtle uppercase">Provenance DAG</p>
      <ol className="flex list-none items-stretch gap-0 p-0" aria-label="Origin provenance">
        {nodes.map((node, i) => (
          <li key={node.key} className="flex min-w-0 flex-1 items-stretch">
            {i > 0 ? (
              <span className="flex w-4 shrink-0 items-center justify-center text-subtle" aria-hidden>
                <ChevronRight className="size-3.5" />
              </span>
            ) : null}
            <div
              className={cn(
                "min-w-0 flex-1 rounded-sm px-2 py-1.5",
                node.active ? "bg-surface-2" : "bg-surface",
              )}
            >
              <p className="truncate text-xs text-subtle">{node.label}</p>
              <p className="truncate font-mono text-xs tabular-nums text-fg">
                {formatPulses(node.value)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
