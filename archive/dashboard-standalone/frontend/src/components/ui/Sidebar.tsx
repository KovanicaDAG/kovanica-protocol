"use client";

import { ChevronLeft, Home, GitBranch, Database, Activity, Users, Clock, Globe, Shield, Coins, Wallet, Layers, ArrowRightLeft, UsersRound, Droplet, Pickaxe, Terminal, BarChart2, Settings, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

export interface Panel {
  id: string;
  label: string;
  icon: string;
}

export interface PanelGroup {
  label: string;
  panels: Panel[];
}

interface SidebarProps {
  panels: Panel[];
  groups?: PanelGroup[];
  activePanel: string;
  onPanelChange: (id: string) => void;
  /** Rendered only inside the <lg drawer as the close affordance. */
  onClose?: () => void;
  /** Mobile drawer: drop the supplementary stats footer to save vertical space. */
  compact?: boolean;
  head: any | null;
  bootstrap: any | null;
}

const iconMap: Record<string, (props: { size?: number }) => React.ReactElement> = {
  home: (props) => <Home {...props} />,
  "git-branch": (props) => <GitBranch {...props} />,
  database: (props) => <Database {...props} />,
  activity: (props) => <Activity {...props} />,
  users: (props) => <Users {...props} />,
  clock: (props) => <Clock {...props} />,
  globe: (props) => <Globe {...props} />,
  shield: (props) => <Shield {...props} />,
  coins: (props) => <Coins {...props} />,
  wallet: (props) => <Wallet {...props} />,
  layers: (props) => <Layers {...props} />,
  swap: (props) => <ArrowRightLeft {...props} />,
  "arrow-right-left": (props) => <ArrowRightLeft {...props} />,
  "users-round": (props) => <UsersRound {...props} />,
  droplet: (props) => <Droplet {...props} />,
  pickaxe: (props) => <Pickaxe {...props} />,
  terminal: (props) => <Terminal {...props} />,
  "bar-chart-2": (props) => <BarChart2 {...props} />,
  settings: (props) => <Settings {...props} />,
};

function navSections(panels: Panel[], groups?: PanelGroup[]): PanelGroup[] {
  if (groups && groups.length > 0) return groups;
  return [{ label: "", panels }];
}

function NavButton({ panel, isActive, onSelect }: { panel: Panel; isActive: boolean; onSelect: (id: string) => void }) {
  const Icon = iconMap[panel.icon] || iconMap.home;
  return (
    <button
      type="button"
      onClick={() => onSelect(panel.id)}
      className={cn(
        "nav-item",
        isActive
          ? "bg-primary/15 text-primary border-l-2 border-primary shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="shrink-0" style={{ flexShrink: 0 }}><Icon size={15} /></span>
      <span className="truncate text-sm">{panel.label}</span>
    </button>
  );
}

function CompactNavButton({ panel, isActive, onSelect }: { panel: Panel; isActive: boolean; onSelect: (id: string) => void }) {
  const Icon = iconMap[panel.icon] || iconMap.home;
  return (
    <button
      type="button"
      onClick={() => onSelect(panel.id)}
      className={cn(
        "flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150",
        isActive
          ? "bg-primary text-primary-foreground shadow-md"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
      aria-current={isActive ? "page" : undefined}
      aria-label={panel.label}
      title={panel.label}
    >
      <span style={isActive ? { filter: "drop-shadow(0 0 8px rgba(255,255,255,0.3))" } : undefined}><Icon size={18} /></span>
    </button>
  );
}

export function Sidebar({ panels, groups, activePanel, onPanelChange, onClose, compact = false, head, bootstrap }: SidebarProps) {
  const sections = navSections(panels, groups);
  const { theme, setTheme } = useTheme();

  return (
    <aside className="w-full h-full bg-card border-r border-border flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-medium text-foreground truncate">Navigation</h2>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] shrink-0"
            aria-label="Close navigation"
          >
            <ChevronLeft size={18} />
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-1.5 space-y-3 scrollbar-thin" aria-label="Dashboard panels">
        {sections.map((section) => (
          <div key={section.label || "panels"} className="space-y-0.5">
            {section.label && (
              <h3 className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{section.label}</h3>
            )}
            <div className="grid grid-cols-3 gap-1">
              {section.panels.map((panel) => (
                <CompactNavButton
                  key={panel.id}
                  panel={panel}
                  isActive={activePanel === panel.id}
                  onSelect={onPanelChange}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {!compact && (
        <div className="p-3 border-t border-border space-y-3">
          <div className="space-y-1.5 text-xs">
            {head && bootstrap && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Supply</span>
                  <span className="font-mono text-foreground">
                    {(bootstrap.native_circulating || 0) / 1e8 > 1e6
                      ? ((bootstrap.native_circulating || 0) / 1e14).toFixed(2) + "M"
                      : ((bootstrap.native_circulating || 0) / 1e8).toFixed(0)
                    } KVNC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Height</span>
                  <span className="font-mono text-foreground">{head.blocks?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Blue Score</span>
                  <span className="font-mono text-foreground">{head.blue_score?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Peers</span>
                  <span className="font-mono text-foreground">{bootstrap.peers?.length || 0}</span>
                </div>
              </>
            )}
          </div>
          
          {/* Theme Toggle */}
          <div className="pt-2 border-t border-border">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? (
                    <>
                      <Moon size={14} className="shrink-0" />
                      <span>Dark Mode</span>
                    </>
                  ) : (
                    <>
                      <Sun size={14} className="shrink-0" />
                      <span>Light Mode</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle theme (current: {theme === "dark" ? "dark" : "light"})</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </aside>
  );
}