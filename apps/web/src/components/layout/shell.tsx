/**
 * Shell — full protocol chrome (testnet / shared hosts only).
 * Not used on apex landing or mainnet gate.
 * NFT in desktop primary NAV (after Assets).
 * Mobile bottom bar stays ≤6 items; NFT via product card / direct URL.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Compass,
  Map,
  Wallet,
  Coins,
  Users,
  FileText,
  Pickaxe,
  Activity,
  Route,
  Eye,
  Lock,
  Vault,
  Layers,
  Droplets,
  Image,
  ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceSwitch } from "@/components/layout/source-switch";
import { NetworkBadge } from "@/components/layout/network-badge";
import { getBadgeColor } from "@/lib/network";

import { Gift } from "lucide-react";

const NAV = [
  { to: "/", label: "Home", icon: Coins },
  { to: "/explorer", label: "Explorer", icon: Compass },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/multisig", label: "Multisig", icon: Users },
  { to: "/multi-asset", label: "Assets", icon: Layers },
  { to: "/nft", label: "NFT", icon: Image },
  { to: "/stealth", label: "Stealth", icon: Eye },
  { to: "/htlc", label: "HTLC", icon: Lock },
  { to: "/wallet/dex", label: "DEX", icon: ArrowLeftRight },
  { to: "/wallet/token-listings", label: "Tokens", icon: Coins },
  { to: "/wallet/airdrops", label: "Airdrops", icon: Gift },
  { to: "/vaults", label: "Vaults", icon: Vault },
  { to: "/network", label: "Network", icon: Activity },
  { to: "/map", label: "Map", icon: Map },
  { to: "/pool", label: "Pool", icon: Pickaxe },
  { to: "/faucet", label: "Faucet", icon: Droplets },
] as const;

/** Bottom bar: keep ≤6 so labels stay readable on narrow phones. */
const MOBILE_NAV = [
  { to: "/", label: "Home", icon: Coins },
  { to: "/explorer", label: "Explorer", icon: Compass },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/multi-asset", label: "Assets", icon: Layers },
  { to: "/network", label: "Network", icon: Activity },
  { to: "/faucet", label: "Faucet", icon: Droplets },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const docsOn = pathname === "/docs" || pathname.startsWith("/docs/");
  const roadmapOn = pathname === "/roadmap" || pathname.startsWith("/roadmap/");

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6"
        style={{ borderTop: `1px solid ${getBadgeColor()}` }}
      >
        <Link to="/" className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="font-mono text-[10px] tracking-brand text-blue uppercase md:text-xs">
            Protocol
          </span>
        </Link>
        <nav className="hidden items-center gap-0.5 xl:gap-1 lg:flex" aria-label="Primary">
          {NAV.filter((n) => n.to !== "/").map((item) => {
            const on = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex h-10 items-center rounded-md px-1.5 text-sm font-medium transition-colors duration-150 xl:px-2.5",
                  on ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            to="/roadmap"
            className={cn(
              "inline-flex h-10 items-center rounded-md px-1.5 text-sm font-medium transition-colors duration-150 xl:px-2.5",
              roadmapOn ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            Roadmap
          </Link>
          <Link
            to="/docs"
            className={cn(
              "inline-flex h-10 items-center rounded-md px-1.5 text-sm font-medium transition-colors duration-150 xl:px-2.5",
              docsOn ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            Docs
          </Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <span className="hidden md:inline-flex">
            <NetworkBadge />
          </span>
          <span className="md:hidden">
            <SourceSwitch compact />
          </span>
          <span className="hidden md:inline-flex">
            <SourceSwitch />
          </span>
          <Link
            to="/roadmap"
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-md md:hidden",
              roadmapOn ? "text-fg" : "text-muted",
            )}
            aria-label="Roadmap"
          >
            <Route className="size-5" />
          </Link>
          <Link
            to="/docs"
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-md md:hidden",
              docsOn ? "text-fg" : "text-muted",
            )}
            aria-label="Docs"
          >
            <FileText className="size-5" />
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>

      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      >
        <ul className="grid grid-cols-6">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const on =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium leading-tight",
                    on ? "text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-5 shrink-0" strokeWidth={on ? 2.2 : 1.8} />
                  <span className="truncate max-w-full">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
