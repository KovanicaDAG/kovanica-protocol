import React, { useEffect, useRef } from 'react';
import { Header } from './Header';
import { Sidebar, type Panel, type PanelGroup } from './Sidebar';
import { Content } from './Content';
import type { WsState } from '../../hooks/useApi';
import type { ApiHead, ApiBootstrap } from '../../types';

/** Tailwind `lg` breakpoint — the drawer/persistent switchover. */
const DESKTOP_QUERY = '(min-width: 1024px)';

export function isDesktop(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * Off-canvas drawer behaviour: escape-to-close, body scroll lock while open and
 * focus hand-off (into the drawer on open, back to the trigger on close).
 */
function useDrawer(
  open: boolean,
  onClose: () => void,
  drawerRef: React.RefObject<HTMLElement>,
  triggerRef: React.RefObject<HTMLElement>,
) {
  const wasOpenRef = useRef(open);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (open && !isDesktop()) {
      document.body.style.overflow = 'hidden';
      drawerRef.current?.focus();
    } else {
      document.body.style.overflow = '';
      if (wasOpen && !isDesktop()) triggerRef.current?.focus();
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [open, drawerRef, triggerRef]);

  useEffect(() => {
    // At >=lg the sidebar is persistent and there is no drawer to close, so
    // Escape must not flip `sidebarOpen` (nothing would reopen it).
    if (!open || isDesktop()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
}

interface LayoutProps {
  children: React.ReactNode;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  panels: Panel[];
  panelGroups?: PanelGroup[];
  activePanel: string;
  onPanelChange: (id: string) => void;
  title: string;
  subtitle: string;
  network: string;
  wsState: WsState;
  head: ApiHead | null;
  bootstrap: ApiBootstrap | null;
  fmtKvnc: (atoms: number) => string;
  lastBlock: string | null;
  txCount: number;
}

export function Layout({
  children,
  sidebarOpen,
  onSidebarToggle,
  panels,
  panelGroups,
  activePanel,
  onPanelChange,
  title,
  subtitle,
  network,
  wsState,
  head,
  bootstrap,
  fmtKvnc,
  lastBlock,
  txCount,
}: LayoutProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDrawer(sidebarOpen, onSidebarToggle, drawerRef, triggerRef);

  const sidebarProps = { panels, groups: panelGroups, activePanel, onPanelChange, head, bootstrap };

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      {/* Off-canvas drawer — <lg only. */}
      <div
        id="dashboard-sidebar"
        className={`fixed inset-0 z-40 lg:hidden ${sidebarOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={sidebarOpen ? undefined : true}
        {...(sidebarOpen ? {} : ({ inert: '' } as Record<string, string>))}
      >
        <div
          onClick={onSidebarToggle}
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-in-out motion-reduce:transition-none ${
            sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />
        <div
          ref={drawerRef}
          tabIndex={-1}
          className={`relative h-full w-72 max-w-[85vw] bg-surface border-r border-border flex flex-col transform transition-transform duration-200 ease-in-out motion-reduce:transition-none outline-none ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar {...sidebarProps} compact onClose={onSidebarToggle} />
        </div>
      </div>

      {/* Persistent sidebar — >=lg, normal in-flow column. */}
      <div className="hidden lg:flex lg:shrink-0 w-72">
        <Sidebar {...sidebarProps} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Header
          onMenuClick={onSidebarToggle}
          menuButtonRef={triggerRef}
          sidebarOpen={sidebarOpen}
          title={title}
          subtitle={subtitle}
          network={network}
          wsState={wsState}
          head={head}
          fmtKvnc={fmtKvnc}
          lastBlock={lastBlock}
          txCount={txCount}
        />
        <Content>{children}</Content>
      </div>
    </div>
  );
}
