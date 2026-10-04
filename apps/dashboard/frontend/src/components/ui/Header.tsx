"use client";

import React, { useEffect, useRef, useState } from "react";
import { Menu, Wifi, WifiOff, Loader2, Circle, Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";
import { useTheme } from "next-themes";
import type { WsState } from "@/hooks/useApi";
import type { ApiHead } from "@/types";

interface HeaderProps {
  onMenuClick: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement>;
  sidebarOpen: boolean;
  title: string;
  subtitle: string;
  network: string;
  wsState: WsState;
  head: ApiHead | null;
  fmtKvnc: (atoms: number) => string;
  lastBlock: string | null;
  txCount: number;
}

const wsStateConfig: Record<WsState, { icon: React.ElementType; color: string; label: string }> = {
  connecting: { icon: Loader2, color: "text-kovanica-gold", label: "Connecting…" },
  connected: { icon: Wifi, color: "text-kovanica-ok", label: "Connected" },
  reconnecting: { icon: Loader2, color: "text-kovanica-gold", label: "Reconnecting…" },
  disconnected: { icon: WifiOff, color: "text-kovanica-danger", label: "Disconnected" },
};

export function Header({
  onMenuClick,
  menuButtonRef,
  sidebarOpen,
  title,
  subtitle,
  network,
  wsState,
  head,
  fmtKvnc,
  lastBlock,
  txCount,
}: HeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const wsConfig = wsStateConfig[wsState];

  const networkColors: Record<string, string> = {
    "kovanica-mainnet": "text-kovanica-net-mainnet",
    "kovanica-testnet": "text-kovanica-net-testnet",
    "kovanica-devnet": "text-kovanica-blue",
  };

  const networkColor = networkColors[network] || "text-muted-foreground";

  return (
    <header className="h-16 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border flex-shrink-0">
      <div className="flex h-full items-center justify-between px-4 gap-4">
        {/* Mobile menu button */}
        <div className="lg:hidden">
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={sidebarOpen}
          >
            <Menu size={20} />
          </Button>
        </div>

        {/* Title area */}
        <div className="flex-1 min-w-0 lg:hidden">
          <h1 className="font-display text-lg font-medium text-foreground truncate">{title}</h1>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>

        {/* Desktop title area */}
        <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-center lg:gap-4">
          <div className="text-center">
            <h1 className="font-display text-xl font-medium text-foreground">{title}</h1>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-3 lg:gap-4">
          {/* WebSocket Status */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <span className="flex items-center gap-1.5">
                  <wsConfig.icon className={cn("h-4 w-4 animate-spin", wsState === "connected" || wsState === "disconnected" && "animate-none", wsConfig.color)} />
                  <span className="hidden sm:inline text-xs font-medium">{wsConfig.label}</span>
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p>WebSocket: {wsConfig.label}</p>
            </TooltipContent>
          </Tooltip>

          {/* Network Badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Circle className={cn("h-2 w-2", networkColor)} />
                <span className={cn("text-xs font-medium", networkColor)}>{network}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p>Network: {network}</p>
            </TooltipContent>
          </Tooltip>

          {/* Last Block Indicator */}
          {lastBlock && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-kovanica-gold">
                  <span className="hidden sm:inline">#{lastBlock.slice(0, 8)}…</span>
                  <span className="sm:hidden">📦</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center">
                <p>Latest block: {lastBlock}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Theme Toggle */}
          {mounted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
                >
                  {resolvedTheme === "dark" ? (
                    <Sun size={18} className="text-kovanica-gold" />
                  ) : (
                    <Moon size={18} className="text-kovanica-blue" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center">
                <p>Current: {resolvedTheme === "dark" ? "Dark" : "Light"} mode</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Desktop title fallback when sidebar is collapsed */}
          <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-end lg:gap-4">
            <div className="text-right">
              <p className="font-display text-lg font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}