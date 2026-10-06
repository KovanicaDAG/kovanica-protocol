import { useEffect, useState } from "react";
import { api, useApiSource } from "@/lib/api/client";
import { type ApiBootstrap } from "@/lib/api/contract";
import { shortId } from "@/lib/ledger/hash";

/**
 * LiveStats — compact live-network strip for marketing surfaces.
 * Client-only, polls /api/bootstrap every 5s, renders nothing on SSR.
 * Degrades to hidden when offline or when the source has no endpoint.
 */
export function LiveStats() {
  const source = useApiSource();
  const [bootstrap, setBootstrap] = useState<ApiBootstrap | null>(null);

  useEffect(() => {
    if (source === "mainnet") {
      setBootstrap(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const b = await api<ApiBootstrap>("/api/bootstrap");
        if (alive) setBootstrap(b);
      } catch {
        // marketing strip degrades gracefully
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [source]);

  if (!bootstrap) return null;

  const cells = [
    { label: "Blocks", value: bootstrap.blocks.toLocaleString() },
    { label: "Tip", value: shortId(bootstrap.tip) },
    { label: "Min fee", value: `${bootstrap.min_fee.toLocaleString()} atoms` },
    { label: "Finality", value: `${bootstrap.finality_depth ?? 100} blue` },
  ];

  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-border bg-surface/60 px-4 py-3 text-center backdrop-blur-sm"
        >
          <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">
            {c.label}
          </p>
          <p className="mt-1 truncate font-mono text-sm text-gold">{c.value}</p>
        </div>
      ))}
    </div>
  );
}