import { useState, useEffect, useCallback, useMemo } from "react";
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
import { FaucetPanel } from "./components/FaucetPanel";
import { MiningPanel } from "./components/MiningPanel";
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
  { id: "faucet", label: "Faucet", icon: "droplet" },
  { id: "mining", label: "Mining", icon: "pickaxe" },
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
      { id: "faucet", label: "Faucet", icon: "droplet" },
      { id: "mining", label: "Mining", icon: "pickaxe" },
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
      case "faucet":
        return <FaucetPanel state={stateQuery.data ?? null} loading={loading} />;
      case "mining":
        return <MiningPanel state={stateQuery.data ?? null} loading={loading} />;
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
  );
}

export default App;