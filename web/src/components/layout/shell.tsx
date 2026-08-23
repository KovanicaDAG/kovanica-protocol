import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, Map, Wallet, Coins, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceSwitch } from "@/components/layout/source-switch";

const NAV = [
  { to: "/", label: "Home", icon: Coins },
  { to: "/explorer", label: "Explorer", icon: Compass },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/map", label: "Map", icon: Map },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const docsOn = pathname === "/docs" || pathname.startsWith("/docs/");

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6">
        <Link to="/" className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="font-mono text-[10px] tracking-brand text-blue uppercase md:text-xs">
            DAG
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.filter((n) => n.to !== "/").map((item) => {
            const on = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex h-10 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150",
                  on ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            to="/docs"
            className={cn(
              "inline-flex h-10 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150",
              docsOn ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            Docs
          </Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <span className="md:hidden">
            <SourceSwitch compact />
          </span>
          <span className="hidden md:inline-flex">
            <SourceSwitch />
          </span>
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
        <ul className="grid grid-cols-4">
          {NAV.map((item) => {
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
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                    on ? "text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-5" strokeWidth={on ? 2.2 : 1.8} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
