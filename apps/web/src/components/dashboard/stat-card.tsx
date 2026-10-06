import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * StatCard — dashboard metric tile.
 * Value auto-renders with the mono display style; accent picks the color
 * (fg default, gold for the headline metric, ok/muted for status).
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "fg",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent?: "fg" | "gold" | "ok" | "muted" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="size-3.5" />
        <p className="text-[10px] tracking-wide uppercase">{label}</p>
      </div>
      <p
        className={cn(
          "mt-2 truncate font-display text-2xl tracking-tight",
          accent === "gold" && "text-gold",
          accent === "ok" && "text-ok",
          accent === "muted" && "text-muted",
          accent === "danger" && "text-danger",
          accent === "fg" && "text-fg",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 truncate font-mono text-[11px] text-subtle">{sub}</p>}
    </div>
  );
}