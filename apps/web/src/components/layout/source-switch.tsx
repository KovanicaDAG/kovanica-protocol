import { useApiSource, setApiSource } from "@/lib/api/client";
import { detectNetwork, switchNetworkHost, type NetworkId } from "@/lib/network";

/**
 * Network switcher in the header.
 *
 * Prefer hard redirect between testnet.kovanica.online ↔ mainnet.kovanica.online
 * so cookies / localStorage / API clients stay isolated (NETWORK.md).
 * Falls back to in-app setApiSource when already on a shared host.
 */
export function SourceSwitch({ compact = false }: { compact?: boolean }) {
  const source = useApiSource();
  const hostNet = typeof window !== "undefined" ? detectNetwork() : "testnet";
  const active: NetworkId =
    source === "mainnet" || hostNet === "mainnet" ? "mainnet" : "testnet";
  const label = active === "mainnet" ? "Mainnet" : "Testnet";

  function select(target: NetworkId) {
    const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
    const onNetworkHost =
      host === "testnet.kovanica.online" ||
      host === "mainnet.kovanica.online" ||
      host.startsWith("testnet.") ||
      host.startsWith("mainnet.");

    if (onNetworkHost && target !== active) {
      switchNetworkHost(target);
      return;
    }
    setApiSource(target);
  }

  if (compact) {
    return (
      <span
        aria-label={`Network: ${label}`}
        className="inline-flex h-9 items-center rounded-md bg-surface-2 px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase"
      >
        {label}
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
        aria-pressed={active === "testnet"}
        onClick={() => select("testnet")}
        className={
          active === "testnet"
            ? "h-8 cursor-pointer rounded-sm bg-bg px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase transition-colors duration-150"
            : "h-8 cursor-pointer rounded-sm px-2.5 font-mono text-[10px] tracking-wide text-muted uppercase transition-colors duration-150 hover:text-fg"
        }
      >
        Testnet
      </button>
      <button
        type="button"
        aria-pressed={active === "mainnet"}
        onClick={() => select("mainnet")}
        title="Mainnet"
        className={
          active === "mainnet"
            ? "h-8 cursor-pointer rounded-sm bg-bg px-2.5 font-mono text-[10px] tracking-wide text-fg uppercase transition-colors duration-150"
            : "h-8 cursor-pointer rounded-sm px-2.5 font-mono text-[10px] tracking-wide text-muted uppercase transition-colors duration-150 hover:text-fg"
        }
      >
        Mainnet
      </button>
    </div>
  );
}
