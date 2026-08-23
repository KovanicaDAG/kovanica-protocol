import { setApiSource, useApiSource } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function SourceSwitch({ compact = false }: { compact?: boolean }) {
  const source = useApiSource();

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setApiSource(source === "live" ? "local" : "live")}
        aria-label={`Node source ${source}. Tap to switch.`}
        className="inline-flex h-9 items-center rounded-md bg-surface-2 px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase"
      >
        {source === "live" ? "Live" : "Preview"}
      </button>
    );
  }

  return (
    <div
      className="inline-flex h-9 items-center rounded-md bg-surface-2 p-0.5"
      role="group"
      aria-label="Node source"
    >
      {(["local", "live"] as const).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => setApiSource(id)}
          className={cn(
            "h-8 rounded-sm px-2.5 font-mono text-[10px] tracking-wide uppercase transition-colors duration-150",
            source === id ? "bg-bg text-fg" : "text-muted hover:text-fg",
          )}
        >
          {id === "local" ? "Preview" : "Live"}
        </button>
      ))}
    </div>
  );
}
