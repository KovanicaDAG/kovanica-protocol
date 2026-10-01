import { useApiSource, setApiSource } from "@/lib/api/client";

/**
 * Network switcher in the header.
 * Mainnet button is now labelled "Mainnet" (no "· soon").
 * It remains selectable; when mainnet proxy is empty the app shows a clear
 * "mainnet not open yet" state via the existing client / dispatch path.
 */
export function SourceSwitch({ compact = false }: { compact?: boolean }) {
  const source = useApiSource();
  const active = source === "mainnet" ? "Mainnet" : "Testnet";

  if (compact) {
    return (
      <span
        aria-label={`Network: ${active}`}
        className="inline-flex h-9 items-center rounded-md bg-surface-2 px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase"
      >
        {active}
      </span>
    );
  }

  return (
    <div
      className="inline-flex h-9 items-center rounded-md bg-surface-2 p-0.5"
      role="group"
      aria-label="Network"
    >
      <button
        type="button"
        aria-pressed={source === "testnet"}
        onClick={() => setApiSource("testnet")}
        className={
          source === "testnet"
            ? "h-8 cursor-pointer rounded-sm bg-bg px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase transition-colors duration-150"
            : "h-8 cursor-pointer rounded-sm px-2.5 font-mono text-[10px] tracking-wide text-muted uppercase transition-colors duration-150 hover:text-fg"
        }
      >
        Testnet
      </button>
      <button
        type="button"
        aria-pressed={source === "mainnet"}
        onClick={() => setApiSource("mainnet")}
        title="Mainnet"
        className={
          source === "mainnet"
            ? "h-8 cursor-pointer rounded-sm bg-bg px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase transition-colors duration-150"
            : "h-8 cursor-pointer rounded-sm px-2.5 font-mono text-[10px] tracking-wide text-muted uppercase transition-colors duration-150 hover:text-fg"
        }
      >
        Mainnet
      </button>
    </div>
  );
}
