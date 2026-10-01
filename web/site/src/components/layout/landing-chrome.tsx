import { NetworkBadge } from "@/components/layout/network-badge";
import { SURFACE } from "@/lib/surfaces";

/**
 * Apex (kovanica.online) chrome — wordmark + light nav only.
 * No Explorer/Wallet/Faucet strip: those live on testnet.* hosts.
 * CTAs on the landing page use absolute SURFACE.* URLs.
 */
export function LandingChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6"
        style={{ borderTop: "1px solid #f59e0b" }}
      >
        <a href={SURFACE.landing} className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="font-mono text-[10px] tracking-brand text-blue uppercase md:text-xs">
            Protocol
          </span>
        </a>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Landing">
          <a
            href={SURFACE.docs}
            className="inline-flex h-9 items-center rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:px-2.5"
          >
            Docs
          </a>
          <a
            href={`${SURFACE.landing}/roadmap`}
            className="inline-flex h-9 items-center rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:px-2.5"
          >
            Roadmap
          </a>
          <a
            href="https://github.com/KovanicaDAG/kovanica-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-9 items-center rounded-md px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex"
          >
            GitHub
          </a>
          <a
            href={SURFACE.testnet}
            className="ml-1 inline-flex h-9 items-center rounded-md bg-surface-2 px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-3"
          >
            Open Testnet
          </a>
          <span className="hidden sm:inline-flex">
            <NetworkBadge />
          </span>
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
