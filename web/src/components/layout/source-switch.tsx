export function SourceSwitch({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span
        aria-label="Network: Testnet"
        className="inline-flex h-9 items-center rounded-md bg-surface-2 px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase"
      >
        Testnet
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
        className="h-8 rounded-sm bg-bg px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase transition-colors duration-150"
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