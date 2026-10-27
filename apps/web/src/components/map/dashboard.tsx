import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { WorldChoropleth, type MapHandle } from "@/components/map/world-choropleth";
import { CountryPanel } from "@/components/map/country-panel";
import { Ranking } from "@/components/map/ranking";
import { OriginsChip } from "@/components/map/metric-switcher";
import { ChoroplethLegend } from "@/components/map/legend";
import { ZoomControls } from "@/components/map/zoom-controls";
import { Button } from "@/components/ui/button";
import {
  CATALOG_BY_ISO3,
  mergePulses,
  toPulseRows,
  type PulseRow,
} from "@/lib/geo/catalog";
import { inferOrigin } from "@/lib/geo/infer-origin";
import { makeColorScale } from "@/lib/geo/scale";
import { api, useApiSource } from "@/lib/api/client";
import type { ApiOrigins } from "@/lib/api/contract";
import { useLedger } from "@/lib/ledger/store";

export function OriginsDashboard() {
  const mapRef = useRef<MapHandle>(null);
  const source = useApiSource();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PulseRow[] | null>(null);
  const originPulses = useLedger((s) => s.originPulses);
  const pulseOrigin = useLedger((s) => s.pulseOrigin);
  const [origin, setOrigin] = useState<{ iso3: string; name: string } | null>(null);

  const loadOrigins = useCallback(async () => {
    try {
      const d = await api<ApiOrigins>("/api/origins");
      setRemote(toPulseRows(d.pulses));
    } catch {
      setRemote(null);
    }
  }, [source]);

  const pulses: PulseRow[] = useMemo(() => {
    const local = toPulseRows(originPulses);
    if (!remote) return local;
    const byIso = new Map(remote.map((p) => [p.iso3, p.pulses]));
    for (const p of local) {
      byIso.set(p.iso3, Math.max(byIso.get(p.iso3) ?? 0, p.pulses));
    }
    return toPulseRows([...byIso.entries()].map(([iso3, n]) => ({ iso3, pulses: n })));
  }, [originPulses, remote]);

  const rows = useMemo(() => mergePulses(pulses), [pulses]);
  const selected = rows.find((r) => r.isoNumeric === selectedId) ?? null;
  const scale = useMemo(() => makeColorScale(rows.map((r) => r.pulses)), [rows]);
  const originId = origin ? (CATALOG_BY_ISO3.get(origin.iso3)?.isoNumeric ?? null) : null;

  useEffect(() => {
    setOrigin(inferOrigin());
  }, []);

  useEffect(() => {
    void loadOrigins();
  }, [loadOrigins]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const recordOrigin = useCallback(() => {
    const o = origin ?? inferOrigin();
    if (!o) {
      toast.error("Could not infer origin from timezone");
      return;
    }
    pulseOrigin(o.iso3);
    void api(`/api/origin?iso3=${o.iso3}`, "POST")
      .then(() => loadOrigins())
      .catch(() => undefined);
    const numeric = CATALOG_BY_ISO3.get(o.iso3)?.isoNumeric;
    if (numeric) {
      setSelectedId(numeric);
      mapRef.current?.focusCountry(numeric);
    }
    toast.success(`Origin recorded · ${o.name}`);
  }, [origin, pulseOrigin, loadOrigins]);

  const selectFromList = (isoNumeric: string) => {
    setSelectedId(isoNumeric);
    mapRef.current?.focusCountry(isoNumeric);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg lg:flex-row">
      <div className="relative min-h-[46vh] min-w-0 flex-1 lg:min-h-0">
        <WorldChoropleth
          ref={mapRef}
          rows={rows}
          selectedId={selectedId}
          originId={originId}
          onSelect={setSelectedId}
        />
        <div className="pointer-events-none absolute inset-0 z-10 p-3 md:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="pointer-events-auto min-w-0">
              <OriginsChip />
            </div>
            <div className="pointer-events-auto">
              <ZoomControls
                onZoomIn={() => mapRef.current?.zoomIn()}
                onZoomOut={() => mapRef.current?.zoomOut()}
                onReset={() => mapRef.current?.reset()}
              />
            </div>
          </div>
          <div className="absolute bottom-3 left-3 md:bottom-4 md:left-4">
            <ChoroplethLegend scale={scale} className="pointer-events-auto" />
          </div>
          <div className="absolute right-3 bottom-3 hidden max-w-56 md:block lg:right-4 lg:bottom-4">
            <div className="pointer-events-auto rounded-lg bg-surface/90 px-3 py-2 shadow-border backdrop-blur-sm">
              <p className="text-xs leading-relaxed text-muted">
                {origin ? (
                  <>
                    Visiting from <span className="text-fg">{origin.name}</span>
                  </>
                ) : (
                  "Origin timezone not recognized."
                )}
              </p>
              <Button type="button" size="sm" className="mt-2 h-9 w-full" onClick={recordOrigin}>
                Record origin
              </Button>
            </div>
          </div>
        </div>
      </div>
      <aside className="flex max-h-[48vh] min-h-0 w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-bg lg:max-h-none lg:w-80 lg:overflow-hidden lg:border-t-0 lg:border-l xl:w-96">
        <div className="px-5 pt-4 md:hidden">
          <Button type="button" className="h-11 w-full" onClick={recordOrigin}>
            Record my origin
          </Button>
        </div>
        <CountryPanel
          rows={rows}
          selected={selected}
          onClear={() => setSelectedId(null)}
          className="shrink-0"
        />
        <Ranking
          rows={rows}
          selectedId={selectedId}
          query={query}
          onQuery={setQuery}
          onSelect={selectFromList}
        />
      </aside>
    </div>
  );
}
