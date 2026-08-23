import { useEffect, useMemo, useRef, useState } from "react";
import type { Block, Colour } from "@/lib/ledger/types";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";

const FILL: Record<Colour, string> = {
  genesis: "var(--color-accent)",
  chain: "var(--color-chain)",
  blue: "var(--color-blue)",
  red: "var(--color-red)",
};

type Props = {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function DagCanvas({ blocks, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      setSize({ w, h });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => layoutBlocks(blocks, size.w, size.h), [blocks, size]);

  return (
    <div ref={wrapRef} className="h-full min-h-[280px] overflow-auto rounded-lg border border-border bg-bg">
      {size.w > 0 ? (
        <svg
          role="img"
          aria-label="BlockDAG"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block"
        >
          {layout.edges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={1.4}
            />
          ))}
          {layout.nodes.map((n) => {
            const active = n.id === selectedId;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                className="cursor-pointer"
                onClick={() => onSelect(n.id)}
              >
                {active ? (
                  <circle r="15" fill="none" stroke="var(--color-fg)" strokeWidth="1.2" opacity="0.5" />
                ) : null}
                <circle r="9" fill={FILL[n.colour]} />
                <text
                  y="24"
                  textAnchor="middle"
                  className="fill-muted"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                >
                  {shortId(n.id, 6)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}

export function DagLegend({ className }: { className?: string }) {
  const items: { colour: Colour; label: string }[] = [
    { colour: "genesis", label: "Genesis" },
    { colour: "chain", label: "Selected chain" },
    { colour: "blue", label: "Blue" },
    { colour: "red", label: "Red" },
  ];
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted", className)}>
      {items.map((it) => (
        <li key={it.colour} className="inline-flex items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: FILL[it.colour] }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function layoutBlocks(blocks: Block[], measuredW: number, measuredH: number) {
  const gen = new Map<string, number>();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const visit = (id: string): number => {
    const cached = gen.get(id);
    if (cached !== undefined) return cached;
    const b = byId.get(id);
    if (!b || b.parents.length === 0) {
      gen.set(id, 0);
      return 0;
    }
    const g = Math.max(...b.parents.map(visit)) + 1;
    gen.set(id, g);
    return g;
  };
  for (const b of blocks) visit(b.id);

  const groups = new Map<number, Block[]>();
  for (const b of blocks) {
    const g = gen.get(b.id) ?? 0;
    const list = groups.get(g) ?? [];
    list.push(b);
    groups.set(g, list);
  }
  const maxGen = Math.max(...groups.keys(), 0);
  const maxRow = Math.max(...[...groups.values()].map((g) => g.length), 1);
  const colW = 64;
  const rowH = 68;
  const padX = 28;
  const padY = 24;
  const width = Math.max(measuredW || 320, padX * 2 + maxRow * colW);
  const contentH = padY * 2 + (maxGen + 1) * rowH;
  const height = Math.max(measuredH || 280, contentH);

  const pos = new Map<string, { x: number; y: number; colour: Colour; id: string }>();
  const yOff = Math.max(0, (height - contentH) / 2);
  for (const [g, list] of groups) {
    list.forEach((b, i) => {
      const span = list.length;
      const x = padX + ((i + 1) / (span + 1)) * (width - padX * 2);
      const y = yOff + padY + g * rowH;
      pos.set(b.id, { x, y, colour: b.colour, id: b.id });
    });
  }

  const edges: { key: string; d: string }[] = [];
  for (const b of blocks) {
    const to = pos.get(b.id);
    if (!to) continue;
    for (const p of b.parents) {
      const from = pos.get(p);
      if (!from) continue;
      const midY = (from.y + to.y) / 2;
      edges.push({
        key: `${p}-${b.id}`,
        d: `M${from.x} ${from.y + 9} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 9}`,
      });
    }
  }

  return { width, height, nodes: [...pos.values()], edges };
}
