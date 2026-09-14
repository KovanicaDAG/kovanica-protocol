import { Link, useRouterState } from "@tanstack/react-router";
import {
  Compass, Map, Wallet, Coins, Users, FileText, Pickaxe, Activity, Route, Bot, Eye, Lock, Vault,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceSwitch } from "@/components/layout/source-switch";
import { LIVE_KOVI } from "@/lib/api/contract";

const NAV = [
  { to: "/", label: "Home", icon: Coins },
  { to: "/explorer", label: "Explorer", icon: Compass },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/multisig", label: "Multisig", icon: Users },
  { to: "/stealth", label: "Stealth", icon: Eye },
  { to: "/htlc", label: "HTLC", icon: Lock },
  { to: "/vaults", label: "Vaults", icon: Vault },
  { to: "/network", label: "Network", icon: Activity },
  { to: "/map", label: "Map", icon: Map },
  { to: "/pool", label: "Pool", icon: Pickaxe },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const docsOn = pathname === "/docs" || pathname.startsWith("/docs/");
  const roadmapOn = pathname === "/roadmap" || pathname.startsWith("/roadmap/");

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6">
        <Link to="/" className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">Kovanica</span>
          <span className="font-mono text-[10px] tracking-brand text-blue uppercase md:text-xs">Protocol</span>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.filter((n) => n.to !== "/").map((item) => {
            const on = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link key={item.to} to={item.to} className={cn(
                "inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium transition-colors duration-150",
                on ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}>{item.label}</Link>
            );
          })}
          <Link to="/roadmap" className={cn("inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium transition-colors duration-150", roadmapOn ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>Roadmap</Link>
          <Link to="/docs" className={cn("inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium transition-colors duration-150", docsOn ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>Docs</Link>
          <a href={LIVE_KOVI} className="inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg">Kovi</a>
        </nav>
        <div className="flex items-center gap-1.5">
          <span className="md:hidden"><SourceSwitch compact /></span>
          <span className="hidden md:inline-flex"><SourceSwitch /></span>
          <Link to="/roadmap" className={cn("inline-flex size-10 items-center justify-center rounded-md md:hidden", roadmapOn ? "text-fg" : "text-muted")} aria-label="Roadmap"><Route className="size-5" /></Link>
          <Link to="/docs" className={cn("inline-flex size-10 items-center justify-center rounded-md md:hidden", docsOn ? "text-fg" : "text-muted")} aria-label="Docs"><FileText className="size-5" /></Link>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">{children}</div>
      <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
        <ul className="grid grid-cols-5 sm:grid-cols-10">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <li key={item.to}>
                <Link to={item.to} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium", on ? "text-fg" : "text-muted")}>
                  <Icon className="size-5" strokeWidth={on ? 2.2 : 1.8} />{item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
