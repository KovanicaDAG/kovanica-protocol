import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3-selection";
import { zoom, zoomIdentity, ZoomBehavior } from "d3-zoom";
import type { Block, Colour } from "@/lib/ledger/types";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";

export const FILL: Record<Colour, string> = {
  genesis: "#ffffff",
  chain: "#f59e0b",
  blue: "#38bdf8",
  red: "#f43f5e",
};

type Props = {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function DagCanvas({ blocks, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
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

  // Setup D3 Zoom & Pan
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 3.5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    // Default transform: focus on recent blocks (towards the bottom)
    if (layout.height > size.h && size.h > 0) {
      svg.call(zoomBehavior.translateTo, layout.width / 2, layout.height - size.h / 2);
    }
  }, [layout.width, layout.height, size.w, size.h]);

  const handleZoomIn = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, 1.3);
  };
  const handleZoomOut = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, 0.75);
  };
  const handleReset = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(
      zoomRef.current.transform,
      zoomIdentity.translate(0, 0).scale(1)
    );
  };
  const handleFocusTip = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(
      zoomRef.current.translateTo,
      layout.width / 2,
      layout.height - size.h / 2
    );
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-[320px] overflow-hidden rounded-lg border border-border bg-bg/90 cursor-grab active:cursor-grabbing select-none"
    >
      {/* Floating Canvas Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-surface/90 backdrop-blur-md p-1 shadow-sm text-xs z-10">
        <button
          type="button"
          onClick={handleZoomIn}
          className="size-7 flex items-center justify-center rounded hover:bg-bg text-muted hover:text-fg font-mono transition-colors"
          title="Zoom In"
        >
          +
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="size-7 flex items-center justify-center rounded hover:bg-bg text-muted hover:text-fg font-mono transition-colors"
          title="Zoom Out"
        >
          −
        </button>
        <button
          type="button"
          onClick={handleFocusTip}
          className="px-2 h-7 flex items-center justify-center rounded hover:bg-bg text-muted hover:text-fg text-[11px] font-mono transition-colors"
          title="Focus Active Tip"
        >
          Tip ↓
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-2 h-7 flex items-center justify-center rounded hover:bg-bg text-muted hover:text-fg text-[11px] font-mono transition-colors"
          title="Reset View"
        >
          Reset
        </button>
      </div>

      {size.w > 0 ? (
        <svg
          ref={svgRef}
          role="img"
          aria-label="BlockDAG"
          width="100%"
          height="100%"
          className="block"
        >
          <defs>
            <filter id="glow-white" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-amber" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <g ref={gRef}>
            {/* 5 Validator Committee Guideline Tracks & Header Badges */}
            {layout.columns.map((col) => (
              <g key={`col-${col.idx}`} opacity={0.65}>
                <line
                  x1={col.cx}
                  y1={36}
                  x2={col.cx}
                  y2={layout.height}
                  stroke="var(--color-border)"
                  strokeDasharray="4 6"
                  strokeWidth={1}
                />
                <rect
                  x={col.cx - 36}
                  y={8}
                  width={72}
                  height={22}
                  rx={6}
                  fill="var(--color-surface)"
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
                <text
                  x={col.cx}
                  y={23}
                  textAnchor="middle"
                  fill="var(--color-muted)"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}
                >
                  Val {col.idx}
                </text>
              </g>
            ))}

            {/* Bezier Edges */}
            {layout.edges.map((e) => (
              <path
                key={e.key}
                d={e.d}
                fill="none"
                stroke={e.color || "var(--color-border)"}
                strokeWidth={e.width || 1.6}
                strokeDasharray={e.dash || "none"}
                opacity={0.8}
              />
            ))}

            {/* Block Nodes */}
            {layout.nodes.map((n) => {
              const active = n.id === selectedId;
              const isGenesis = n.colour === "genesis";
              const isTip = n.colour === "chain";
              const isRed = n.colour === "red";

              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x} ${n.y})`}
                  className="cursor-pointer transition-transform hover:scale-110"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(n.id);
                  }}
                >
                  {/* Active selection ring */}
                  {active ? (
                    <circle
                      r="18"
                      fill="none"
                      stroke="var(--color-fg)"
                      strokeWidth="1.5"
                      opacity="0.8"
                    />
                  ) : null}

                  {/* Pulsing ring for Tip */}
                  {isTip ? (
                    <circle
                      r="16"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="1.5"
                      opacity="0.6"
                      className="animate-pulse"
                    />
                  ) : null}

                  {/* Outer circle / glow */}
                  <circle
                    r={isGenesis ? 11 : isTip ? 11 : 9}
                    fill={FILL[n.colour]}
                    filter={isGenesis ? "url(#glow-white)" : isTip ? "url(#glow-amber)" : undefined}
                    stroke={isRed ? "#ffffff" : isGenesis ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)"}
                    strokeWidth={isRed ? 1.5 : 1}
                    strokeDasharray={isRed ? "2 2" : "none"}
                  />

                  {/* Inner dot for Genesis */}
                  {isGenesis ? (
                    <circle r="3" fill="#000000" opacity="0.6" />
                  ) : null}

                  {/* Node label */}
                  <text
                    y="22"
                    textAnchor="middle"
                    className="fill-muted font-medium"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                  >
                    {isGenesis
                      ? "#0 Genesis"
                      : isRed
                      ? "Uncommitted"
                      : `#${n.height} ${isTip ? "TIP" : ""}`}
                  </text>
                  <text
                    y="33"
                    textAnchor="middle"
                    className="fill-subtle"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 8.5 }}
                  >
                    {shortId(n.id, 5)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}
    </div>
  );
}

export function DagLegend({ className }: { className?: string }) {
  const items: { colour: Colour; label: string; desc: string }[] = [
    { colour: "chain", label: "Selected Tip", desc: "Active leader" },
    { colour: "blue", label: "Committed Leader", desc: "BFT finalized" },
    { colour: "genesis", label: "Genesis Block", desc: "Block #0" },
    { colour: "red", label: "Uncommitted / Fork", desc: "Pending certification" },
  ];
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 text-xs text-muted w-full", className)}>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {items.map((it) => (
          <li key={it.colour} className="inline-flex items-center gap-2">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full border border-black/20 shadow-sm",
                it.colour === "genesis" && "border-white/80 shadow-white/40",
                it.colour === "chain" && "ring-2 ring-amber-500/40"
              )}
              style={{ background: FILL[it.colour] }}
              aria-hidden
            />
            <span className="font-medium text-fg">{it.label}</span>
            <span className="text-subtle text-[11px]">({it.desc})</span>
          </li>
        ))}
      </ul>
      <div className="hidden sm:flex items-center gap-2 text-[11px] text-subtle">
        <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
        <span>5 Validator Committee Lanes (Val 0 – 4)</span>
      </div>
    </div>
  );
}

function layoutBlocks(blocks: Block[], measuredW: number, measuredH: number) {
  const width = Math.max(measuredW || 700, 600);
  const padX = Math.max(36, Math.min(100, width * 0.06));
  const colWidth = (width - padX * 2) / 5;
  const colCenterX = (v: number) => padX + (v + 0.5) * colWidth;

  const columns = Array.from({ length: 5 }).map((_, i) => ({
    idx: i,
    cx: colCenterX(i),
  }));

  // Sort blocks by height so Genesis (#0) is at top, proceeding down to Tip & uncommitted
  const sorted = [...blocks].sort((a, b) => a.height - b.height);

  const startY = 64;
  const rowH = 62;
  const contentH = startY + sorted.length * rowH + 60;
  const height = Math.max(measuredH || 360, contentH);

  const pos = new Map<string, { x: number; y: number; colour: Colour; id: string; height: number; nonce: number }>();

  sorted.forEach((b, idx) => {
    const val = (b.nonce >= 0 && b.nonce < 5) ? b.nonce : (Math.abs(b.nonce) % 5);
    const x = colCenterX(val);
    const y = startY + idx * rowH;
    pos.set(b.id, { x, y, colour: b.colour, id: b.id, height: b.height, nonce: val });
  });

  const edges: { key: string; d: string; color?: string; width?: number; dash?: string }[] = [];
  for (const b of sorted) {
    const to = pos.get(b.id);
    if (!to) continue;
    for (const p of b.parents) {
      const from = pos.get(p);
      if (!from) continue;
      const midY = (from.y + to.y) / 2;
      const isRed = b.colour === "red";
      edges.push({
        key: `${p}-${b.id}`,
        d: `M${from.x} ${from.y + 11} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 11}`,
        color: isRed ? "var(--color-red)" : "var(--color-border)",
        width: isRed ? 1.4 : 1.8,
        dash: isRed ? "3 3" : undefined,
      });
    }
  }

  return { width, height, columns, nodes: [...pos.values()], edges };
}
