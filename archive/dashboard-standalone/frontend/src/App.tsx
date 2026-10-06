import { useState, useEffect, useCallback, useMemo } from "react";

// Global mount check
if (typeof window !== "undefined") {
  console.log("🔵 App module executing, React version:", (window as any).React?.version || "unknown");
  const root = document.getElementById("root");
  if (root) {
    root.style.border = "3px solid lime";
    root.style.minHeight = "50vh";
    root.style.background = "rgba(0,255,0,0.05)";
  }
}

// Force visible debug bar at top of viewport
if (typeof window !== "undefined" && !document.getElementById("kovanica-debug-bar")) {
  const bar = document.createElement("div");
  bar.id = "kovanica-debug-bar";
  bar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; height: 28px;
    background: #eab308; color: #1a1a1a; font-family: monospace; font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    z-index: 2147483647; border-bottom: 2px solid #facc15;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  `;
  bar.textContent = "⚡ React loading… " + new Date().toLocaleTimeString();
  document.body.appendChild(bar);
  
  // Update every second
  setInterval(() => {
    const bar = document.getElementById("kovanica-debug-bar");
    if (bar) {
      bar.textContent = "✅ React running • " + new Date().toLocaleTimeString() + " • check console";
    }
  }, 1000);
}

// Global error handler for debugging
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;top:0;left:0;right:0;background:red;color:white;padding:1rem;z-index:99999;font-family:monospace;font-size:14px;";
    div.textContent = "JS Error: " + (e.message || e.error?.message || "unknown") + " at " + (e.filename || "") + ":" + (e.lineno || "");
    document.body.appendChild(div);
    console.error("Global error:", e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;top:40px;left:0;right:0;background:orange;color:black;padding:1rem;z-index:99999;font-family:monospace;font-size:14px;";
    div.textContent = "Unhandled Promise Rejection: " + (e.reason?.message || e.reason || "unknown");
    document.body.appendChild(div);
    console.error("Unhandled rejection:", e);
  });
}
import { Layout } from "./components/ui/Layout";
import { OverviewPanel } from "./components/OverviewPanel";
import { BlockDagPanel } from "./components/BlockDagPanel";
import { BlocksPanel } from "./components/BlocksPanel";
import { TransactionsPanel } from "./components/TransactionsPanel";
import { AddressesPanel } from "./components/AddressesPanel";
import { MempoolPanel } from "./components/MempoolPanel";
import { NetworkPanel } from "./components/NetworkPanel";
import { ConsensusPanel } from "./components/ConsensusPanel";
import { TokensPanel } from "./components/TokensPanel";
import { HtlcPanel } from "./components/HtlcPanel";
import { MultisigPanel } from "./components/MultisigPanel";
import { ApiConsolePanel } from "./components/ApiConsolePanel";
import { MetricsPanel } from "./components/MetricsPanel";
import { OpsPanel } from "./components/OpsPanel";
import { WalletPanel } from "./components/WalletPanel";
import { AssetsPanel } from "./components/AssetsPanel";
import {
  useHead,
  useBootstrap,
  useStateNode,
  useNetwork,
  useWebSocket,
  fmtKvnc,
} from "./hooks/useApi";
import { usePanelRoute } from "./hooks/usePanelRoute";
import type { ApiHead } from "./types";
import type { WsMsg } from "./types";
import type { Panel, PanelGroup } from "./components/ui/Sidebar";

const PANELS: Panel[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "blockdag", label: "BlockDAG", icon: "git-branch" },
  { id: "blocks", label: "Blocks", icon: "database" },
  { id: "txs", label: "Transactions", icon: "activity" },
  { id: "mempool", label: "Mempool", icon: "clock" },
  { id: "wallet", label: "Wallet", icon: "wallet" },
  { id: "addresses", label: "Addresses", icon: "users" },
  { id: "tokens", label: "Tokens", icon: "coins" },
  { id: "assets", label: "Multi-Asset", icon: "layers" },
  { id: "network", label: "Network", icon: "globe" },
  { id: "consensus", label: "Consensus", icon: "shield" },
  { id: "htlc", label: "HTLC", icon: "swap" },
  { id: "multisig", label: "Multisig", icon: "users-round" },
  { id: "api", label: "API Console", icon: "terminal" },
  { id: "metrics", label: "Metrics", icon: "bar-chart-2" },
  { id: "ops", label: "Ops", icon: "settings" },
];

const PANEL_GROUPS: PanelGroup[] = [
  {
    label: "Chain",
    panels: [
      { id: "overview", label: "Overview", icon: "home" },
      { id: "blockdag", label: "BlockDAG", icon: "git-branch" },
      { id: "blocks", label: "Blocks", icon: "database" },
      { id: "txs", label: "Transactions", icon: "activity" },
      { id: "mempool", label: "Mempool", icon: "clock" },
    ],
  },
  {
    label: "Data & Identity",
    panels: [
      { id: "wallet", label: "Wallet", icon: "wallet" },
      { id: "addresses", label: "Addresses", icon: "users" },
      { id: "tokens", label: "Tokens", icon: "coins" },
      { id: "assets", label: "Multi-Asset", icon: "layers" },
    ],
  },
  {
    label: "Network & Consensus",
    panels: [
      { id: "network", label: "Network", icon: "globe" },
      { id: "consensus", label: "Consensus", icon: "shield" },
    ],
  },
  {
    label: "DeFi & Interop",
    panels: [
      { id: "htlc", label: "HTLC", icon: "swap" },
      { id: "multisig", label: "Multisig", icon: "users-round" },
    ],
  },
  {
    label: "Tools & Dev",
    panels: [
      { id: "api", label: "API Console", icon: "terminal" },
      { id: "metrics", label: "Metrics", icon: "bar-chart-2" },
    ],
  },
  { label: "Ops", panels: [{ id: "ops", label: "Ops", icon: "settings" }] },
];

// The sidebar renders from PANEL_GROUPS; PANELS is the flat id list used for
// route validation. Every panel must appear in both or it is unreachable.

const VALID_IDS = PANELS.map((p) => p.id);

const DESKTOP_QUERY = "(min-width: 1024px)";

function isDesktop(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

type PanelId = (typeof PANELS)[number]["id"];

function deriveNetwork(head: ApiHead | null, bootstrap: any): string {
  const candidates: unknown[] = [
    head?.network,
    head?.net,
    bootstrap?.network,
    bootstrap?.net,
    bootstrap?.network_id,
    bootstrap?.chain_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  const genesis = bootstrap?.genesis || head?.genesis;
  if (typeof genesis === "string" && genesis.includes("mainnet")) return "kovanica-mainnet";
  if (typeof genesis === "string" && genesis.includes("testnet")) return "kovanica-testnet";
  return "unknown";
}

function App() {
  const [activePanel, setActivePanelRoute] = usePanelRoute(VALID_IDS, "overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    setSidebarOpen(mq.matches);
    const onChange = (ev: MediaQueryListEvent) => setSidebarOpen(ev.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const headQuery = useHead(5000);
  const bootstrapQuery = useBootstrap(5000);
  const stateQuery = useStateNode(5000);
  const networkQuery = useNetwork(4000);

  const loading = headQuery.isLoading || bootstrapQuery.isLoading || stateQuery.isLoading || networkQuery.isLoading;

  // /api/head does not emit blue_score — it lives on /api/state's node object.
  // Header, Sidebar and Overview all read `head.blue_score`, so backfill it here
  // where both responses are in scope.
  const head = useMemo<ApiHead | null>(() => {
    if (!headQuery.data) return null;
    if (typeof headQuery.data.blue_score === "number") return headQuery.data;
    const fromState = stateQuery.data?.node?.blue_score;
    return typeof fromState === "number" ? { ...headQuery.data, blue_score: fromState } : headQuery.data;
  }, [headQuery.data, stateQuery.data]);

  const [lastBlock, setLastBlock] = useState<string | null>(null);
  const [txCount, setTxCount] = useState(0);

  const handleWsMessage = useCallback((msg: WsMsg) => {
    switch (msg.type) {
      case "block":
        setLastBlock(msg.id);
        break;
      case "tx":
        setTxCount((c) => c + 1);
        break;
      case "tip":
      case "peer":
      case "state":
        break;
    }
  }, []);

  const { state: wsState } = useWebSocket(handleWsMessage);

  const onPanelChange = useCallback(
    (id: PanelId | string) => {
      setActivePanelRoute(id);
      if (!isDesktop()) setSidebarOpen(false);
    },
    [setActivePanelRoute],
  );

  const onSidebarToggle = useCallback(() => setSidebarOpen((o) => !o), []);

  const network = deriveNetwork(head, bootstrapQuery.data);
  const activeLabel = PANELS.find((p) => p.id === activePanel)?.label ?? "Overview";
  const blockCount = head?.blocks ?? stateQuery.data?.node?.blocks ?? 0;
  const subtitle = `${network}${blockCount > 0 ? ` • ${blockCount.toLocaleString()} blocks` : ""}`;

  const renderPanel = () => {
    switch (activePanel) {
      case "overview":
        return <OverviewPanel head={head} bootstrap={bootstrapQuery.data ?? null} state={stateQuery.data ?? null} loading={loading} />;
      case "blockdag":
        return <BlockDagPanel state={stateQuery.data ?? null} loading={loading} />;
      case "blocks":
        return <BlocksPanel state={stateQuery.data ?? null} loading={loading} />;
      case "txs":
        return <TransactionsPanel state={stateQuery.data ?? null} loading={loading} />;
      case "addresses":
        return <AddressesPanel state={stateQuery.data ?? null} loading={loading} />;
      case "wallet":
        return <WalletPanel />;
      case "assets":
        return <AssetsPanel />;
      case "mempool":
        return <MempoolPanel state={stateQuery.data ?? null} loading={loading} />;
      case "network":
        return <NetworkPanel bootstrap={bootstrapQuery.data ?? null} state={stateQuery.data ?? null} loading={loading} />;
      case "consensus":
        return <ConsensusPanel network={networkQuery.data ?? null} state={stateQuery.data ?? null} loading={loading} />;
      case "tokens":
        return <TokensPanel state={stateQuery.data ?? null} loading={loading} />;
      case "htlc":
        return <HtlcPanel />;
      case "multisig":
        return <MultisigPanel />;
      case "api":
        return <ApiConsolePanel />;
      case "metrics":
        return <MetricsPanel />;
      case "ops":
        return <OpsPanel />;
      default:
        return <OverviewPanel head={head} bootstrap={bootstrapQuery.data ?? null} state={stateQuery.data ?? null} loading={loading} />;
    }
  };

  return (
    <>
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 32,
        background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'monospace', fontSize: 12, zIndex: 9999,
        borderBottom: '2px solid hsl(var(--border))'
      }}>
        🟢 React mounted • {new Date().toLocaleTimeString()} • active: {activePanel} • ws: {wsState}
      </div>
      <Layout
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
        panels={PANELS}
        panelGroups={PANEL_GROUPS}
        activePanel={activePanel}
        onPanelChange={onPanelChange}
        title={activeLabel}
        subtitle={subtitle}
        network={network}
        wsState={wsState}
        head={head}
        bootstrap={bootstrapQuery.data ?? null}
        fmtKvnc={fmtKvnc}
        lastBlock={lastBlock}
        txCount={txCount}
      >
        {renderPanel()}
      </Layout>
    </>
  );
}

export default App;