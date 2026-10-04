/**
 * PlaygroundChrome — layout for playground.kovanica.online.
 * Three tabs: Onboarding, API Console, Code Snippets.
 * Simplified nav vs the full Shell — no Explorer/Wallet/Multisig strip.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { GraduationCap, Terminal, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkBadge } from "@/components/layout/network-badge";

const TABS = [
  { to: "/playground", label: "Onboarding", icon: GraduationCap },
  { to: "/playground/api-console", label: "API Console", icon: Terminal },
  { to: "/playground/snippets", label: "Snippets", icon: Code2 },
] as const;

export function PlaygroundChrome({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6"
        style={{ borderTop: "1px solid #8b5cf6" }}
      >
        <Link to="/playground" className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="font-mono text-[10px] tracking-brand text-purple-400 uppercase md:text-xs">
            Playground
          </span>
        </Link>
        <nav className="hidden items-center gap-0.5 sm:flex" aria-label="Playground">
          {TABS.map((item) => {
            const on =
              item.to === "/playground"
                ? pathname === "/playground" || pathname === "/playground/"
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium transition-colors duration-150",
                  on ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1.5">
          <NetworkBadge />
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav
        aria-label="Playground mobile"
        className="sticky top-14 z-20 flex border-b border-border bg-bg/95 sm:hidden"
      >
        <div className="grid w-full grid-cols-3">
          {TABS.map((item) => {
            const Icon = item.icon;
            const on =
              item.to === "/playground"
                ? pathname === "/playground" || pathname === "/playground/"
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium leading-tight",
                  on ? "text-fg" : "text-muted",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={on ? 2.2 : 1.8} />
                <span className="truncate max-w-full">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
