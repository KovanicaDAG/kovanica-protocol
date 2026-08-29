import { useApiSource, setApiSource } from "@/lib/api/client";

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
        aria-pressed="true"
        onClick={() => setApiSource("testnet")}
        className="h-8 cursor-pointer rounded-sm bg-bg px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase transition-colors duration-150"
      >
        Testnet
      </button>
      <button
        type="button"
        disabled
        title="Launching soon"
        className="h-8 cursor-default px-2.5 font-mono text-[10px] tracking-wide text-muted uppercase"
      >
        Mainnet · soon
      </button>
    </div>
  );
}
