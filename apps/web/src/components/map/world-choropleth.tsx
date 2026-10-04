import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  useCallback,
  forwardRef,
  memo,
} from "react";
import {
  geoNaturalEarth1,
  geoPath,
  geoGraticule10,
  type GeoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";
import { cn } from "@/lib/utils";
import { CATALOG_BY_NUMERIC, type CountryView } from "@/lib/geo/catalog";
import { formatPulses } from "@/lib/geo/metrics";
import { makeColorScale } from "@/lib/geo/scale";

type CountryProps = { name: string };

type WorldTopology = Topology<{
  countries: GeometryCollection<CountryProps>;
}>;

const topology = worldAtlas as unknown as WorldTopology;
const collection = feature(
  topology,
  topology.objects.countries,
) as FeatureCollection<Geometry, CountryProps>;

function isoNumeric(id: unknown): string {
  return String(id ?? "").padStart(3, "0");
}

export type MapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  focusCountry: (isoNumeric: string) => void;
};

type Props = {
  rows: CountryView[];
  selectedId: string | null;
  originId?: string | null;
  onSelect: (isoNumeric: string | null) => void;
  className?: string;
};

type Tip = { x: number; y: number; id: string; name: string; value: number | undefined };

type LandInfo = {
  fill: string;
  value: number | undefined;
  name: string;
  hasData: boolean;
};

export const WorldChoropleth = forwardRef<MapHandle, Props>(function WorldChoropleth(
  { rows, selectedId, originId, onSelect, className },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomLayerRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Tip | null>(null);

  const scale = useMemo(
    () => makeColorScale(rows.map((r) => r.pulses)),
    [rows],
  );

  const lands = useMemo(() => {
    const byNumeric = new Map<string, CountryView>();
    for (const row of rows) byNumeric.set(row.isoNumeric, row);
    const out = new Map<string, LandInfo>();
    for (const feat of collection.features) {
      const id = isoNumeric(feat.id);
      const row = byNumeric.get(id);
      const catalog = CATALOG_BY_NUMERIC.get(id);
      const name = catalog?.name ?? feat.properties.name;
      const value = row?.pulses;
      out.set(id, {
        fill: scale.color(value),
        value,
        name,
        hasData: (row?.pulses ?? 0) > 0,
      });
    }
    return out;
  }, [rows, scale]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      if (w < 8 || h < 8) return;
      setSize({ w, h });
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => {
    if (size.w === 0) return null;
    return geoNaturalEarth1().fitExtent(
      [
        [16, 24],
        [size.w - 16, size.h - 12],
      ],
      { type: "Sphere" },
    );
  }, [size]);

  const pathGen = useMemo(() => {
    if (!projection) return null;
    return geoPath(projection);
  }, [projection]);

  useEffect(() => {
    const svg = svgRef.current;
    const layer = zoomLayerRef.current;
    if (!svg || !layer || size.w === 0) return;
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .clickDistance(6)
      .extent([
        [0, 0],
        [size.w, size.h],
      ])
      .translateExtent([
        [-size.w * 0.35, -size.h * 0.35],
        [size.w * 1.35, size.h * 1.35],
      ])
      .on("zoom", (event) => {
        select(layer).attr("transform", event.transform.toString());
      });
    zoomRef.current = behavior;
    const sel = select(svg);
    sel.call(behavior);
    return () => {
      sel.on(".zoom", null);
      zoomRef.current = null;
    };
  }, [size]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const svg = svgRef.current;
        const z = zoomRef.current;
        if (!svg || !z) return;
        z.scaleBy(select(svg), 1.4);
      },
      zoomOut: () => {
        const svg = svgRef.current;
        const z = zoomRef.current;
        if (!svg || !z) return;
        z.scaleBy(select(svg), 1 / 1.4);
      },
      reset: () => {
        const svg = svgRef.current;
        const z = zoomRef.current;
        if (!svg || !z) return;
        z.transform(select(svg), zoomIdentity);
      },
      focusCountry: (numeric: string) => {
        const svg = svgRef.current;
        const z = zoomRef.current;
        if (!svg || !z || !pathGen || size.w === 0) return;
        const feat = collection.features.find((f) => isoNumeric(f.id) === numeric);
        if (!feat) return;
        const bounds = pathGen.bounds(feat);
        const dx = bounds[1][0] - bounds[0][0];
        const dy = bounds[1][1] - bounds[0][1];
        const cx = (bounds[0][0] + bounds[1][0]) / 2;
        const cy = (bounds[0][1] + bounds[1][1]) / 2;
        const k = Math.max(1.2, Math.min(6, 0.55 / Math.max(dx / size.w, dy / size.h)));
        const t = zoomIdentity.translate(size.w / 2, size.h / 2).scale(k).translate(-cx, -cy);
        z.transform(select(svg), t);
      },
    }),
    [pathGen, size],
  );

  const isClick = useCallback((clientX: number, clientY: number) => {
    const dx = clientX - pointerRef.current.x;
    const dy = clientY - pointerRef.current.y;
    return Math.hypot(dx, dy) < 6;
  }, []);

  const onHover = useCallback((next: Tip | null) => {
    setHover(next);
  }, []);

  const spherePath = pathGen?.({ type: "Sphere" } as GeoPermissibleObjects) ?? "";
  const graticulePath = pathGen?.(geoGraticule10()) ?? "";

  return (
    <div ref={wrapRef} className={cn("relative h-full w-full overflow-hidden bg-ocean", className)}>
      {size.w > 0 && pathGen ? (
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          className="block h-full w-full touch-none"
          role="img"
          aria-label="World map of Kovanica origin pulses"
          onPointerDown={(e) => {
            pointerRef.current = { x: e.clientX, y: e.clientY };
          }}
          onMouseLeave={() => setHover(null)}
        >
          <rect
            width={size.w}
            height={size.h}
            className="fill-ocean"
            onClick={(e) => {
              if (isClick(e.clientX, e.clientY)) onSelect(null);
            }}
          />
          <g ref={zoomLayerRef}>
            <path d={spherePath} className="fill-ocean" stroke="none" pointerEvents="none" />
            <path
              d={graticulePath}
              fill="none"
              stroke="currentColor"
              className="text-fg/6"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <CountryLayer
              pathGen={pathGen}
              lands={lands}
              selectedId={selectedId}
              isClick={isClick}
              onHover={onHover}
              onSelect={onSelect}
            />
            {originId ? <OriginPulse pathGen={pathGen} originId={originId} /> : null}
          </g>
        </svg>
      ) : (
        <div className="h-full w-full bg-ocean" />
      )}
      {hover ? <MapTooltip tip={hover} /> : null}
    </div>
  );
});

const CountryLayer = memo(function CountryLayer({
  pathGen,
  lands,
  selectedId,
  isClick,
  onHover,
  onSelect,
}: {
  pathGen: GeoPath;
  lands: Map<string, LandInfo>;
  selectedId: string | null;
  isClick: (x: number, y: number) => boolean;
  onHover: (tip: Tip | null) => void;
  onSelect: (isoNumeric: string | null) => void;
}) {
  return collection.features.map((feat, index) => {
    const id = isoNumeric(feat.id);
    const d = pathGen(feat) ?? "";
    if (!d) return null;
    const info = lands.get(id);
    if (!info) return null;
    return (
      <CountryPath
        key={`${id}-${index}`}
        id={id}
        d={d}
        info={info}
        selected={selectedId === id}
        isClick={isClick}
        onHover={onHover}
        onSelect={onSelect}
      />
    );
  });
});

const CountryPath = memo(function CountryPath({
  id,
  d,
  info,
  selected,
  isClick,
  onHover,
  onSelect,
}: {
  id: string;
  d: string;
  info: LandInfo;
  selected: boolean;
  isClick: (x: number, y: number) => boolean;
  onHover: (tip: Tip | null) => void;
  onSelect: (isoNumeric: string | null) => void;
}) {
  return (
    <path
      d={d}
      data-iso={id}
      className={cn("map-land", selected && "is-selected")}
      fill={info.fill}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: info.hasData ? "pointer" : "default" }}
      onMouseEnter={(e) => {
        onHover({ x: e.clientX, y: e.clientY, id, name: info.name, value: info.value });
      }}
      onMouseMove={(e) => {
        onHover({ x: e.clientX, y: e.clientY, id, name: info.name, value: info.value });
      }}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (!isClick(e.clientX, e.clientY)) return;
        onSelect(selected ? null : id);
      }}
    />
  );
});

function OriginPulse({ pathGen, originId }: { pathGen: GeoPath; originId: string }) {
  const feat = collection.features.find((f) => isoNumeric(f.id) === originId);
  if (!feat) return null;
  const centroid = pathGen.centroid(feat);
  if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) return null;
  return (
    <g transform={`translate(${centroid[0]} ${centroid[1]})`} pointerEvents="none" aria-hidden>
      <circle className="origin-pulse-ring" r="7" />
      <circle className="origin-pulse-dot" r="2.8" />
    </g>
  );
}

function MapTooltip({ tip }: { tip: Tip }) {
  const pad = 12;
  const left = Math.min(tip.x + 16, (typeof window !== "undefined" ? window.innerWidth : 400) - 180);
  const top = Math.min(tip.y + 16, (typeof window !== "undefined" ? window.innerHeight : 400) - 72);
  return (
    <div
      className="pointer-events-none fixed z-40 min-w-36 rounded-md bg-surface-2 px-3 py-2 shadow-border"
      data-testid="map-tooltip"
      style={{ left: Math.max(pad, left), top: Math.max(pad, top) }}
    >
      <p className="text-sm font-medium text-fg">{tip.name}</p>
      <p className="mt-0.5 font-mono text-xs tabular-nums text-muted">
        {tip.value === undefined || tip.value <= 0
          ? "No pulses yet"
          : `${formatPulses(tip.value)} ${tip.value === 1 ? "pulse" : "pulses"}`}
      </p>
    </div>
  );
}

export { collection as COUNTRY_FEATURES };
