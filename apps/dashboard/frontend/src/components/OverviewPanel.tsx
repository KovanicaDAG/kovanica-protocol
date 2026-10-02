import { StatCard, Badge, Table, Card, CardContent, CardHeader, CardTitle } from "./ui";
import { Coins, TrendingUp, Flame, Blocks, Network, Shield, Activity, Target, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { fmtKvnc, fmtNumber, fmtPercent } from "../hooks/useApi";
import type { ApiHead, ApiBootstrap, ApiState } from "../types";

interface OverviewPanelProps {
  head: ApiHead | null;
  bootstrap: ApiBootstrap | null;
  state: ApiState | null;
  loading: boolean;
}

export function OverviewPanel({ head, bootstrap, state, loading }: OverviewPanelProps) {
  const supplyMinted = bootstrap?.native_minted || 0;
  const supplyTotal = bootstrap?.native_total || 0;
  const supplyCirculating = bootstrap?.native_circulating || 0;
  const supplyBurned = bootstrap?.native_burned || 0;
  const supplyMax = bootstrap?.native_max_supply || 9_020_000_000_000_000;
  const subsidy = bootstrap?.subsidy || head?.subsidy || 1_000_000_000;
  const era = Math.floor((head?.blocks || 0) / 2_050_000);
  const percent = supplyMax > 0 ? (supplyCirculating / supplyMax) * 100 : 0;
  const remainingPercent = supplyMax > 0 ? ((supplyMax - supplyCirculating) / supplyMax) * 100 : 0;

  const statCards = [
    {
      label: "Circulating Supply",
      value: fmtKvnc(supplyCirculating),
      trend: `${fmtPercent(percent / 100)} of max supply`,
      trendUp: true,
      icon: <Coins size={24} className="text-kovanica-gold" />,
    },
    {
      label: "Total Minted",
      value: fmtKvnc(supplyMinted),
      trend: fmtKvnc(supplyMax - supplyMinted) + " remaining",
      trendUp: supplyMinted < supplyMax,
      icon: <TrendingUp size={24} className="text-kovanica-ok" />,
    },
    {
      label: "Burned (75% fees)",
      value: fmtKvnc(supplyBurned),
      trend: "Deflationary pressure",
      trendUp: true,
      icon: <Flame size={24} className="text-kovanica-danger" />,
    },
    {
      label: "Current Subsidy",
      value: fmtKvnc(subsidy),
      trend: `Era ${era} (${2_050_000 * era}–${2_050_000 * (era + 1) - 1})`,
      trendUp: false,
      icon: <Blocks size={24} className="text-kovanica-blue" />,
    },
    {
      label: "Block Height",
      value: fmtNumber(head?.blocks || 0),
      trend: `Blue score: ${fmtNumber(head?.blue_score || 0)}`,
      trendUp: true,
      icon: <Blocks size={24} className="text-kovanica-blue" />,
    },
    {
      label: "Network",
      value: head?.network || "unknown",
      trend: `${bootstrap?.peers?.length || 0} peers`,
      trendUp: (bootstrap?.peers?.length || 0) > 0,
      icon: <Network size={24} className="text-kovanica-blue" />,
    },
    {
      label: "Mempool",
      value: fmtNumber(state?.node?.mempool || 0),
      trend: `${fmtNumber(state?.node?.tx_count || 0)} total TXs`,
      trendUp: false,
      icon: <Activity size={24} className="text-kovanica-gold" />,
    },
    {
      label: "Consensus",
      value: `k=${head?.k || 3} GHOSTDAG`,
      trend: `PoA ${state?.node?.authority_pk?.slice(0, 12) + "…" || "—"}`,
      trendUp: true,
      icon: <Shield size={24} className="text-kovanica-ok" />,
    },
  ];

  const supplyRows = [
    ["Minted", fmtKvnc(supplyMinted), fmtPercent(supplyMinted / supplyMax)],
    ["Total (minted - burned)", fmtKvnc(supplyTotal), fmtPercent(supplyTotal / supplyMax)],
    ["Circulating", fmtKvnc(supplyCirculating), fmtPercent(supplyCirculating / supplyMax)],
    ["Burned (75% fees)", fmtKvnc(supplyBurned), fmtPercent(supplyBurned / supplyMax)],
    ["Max Supply (hard cap)", fmtKvnc(supplyMax), "100%"],
    ["Remaining", fmtKvnc(supplyMax - supplyCirculating), fmtPercent((supplyMax - supplyCirculating) / supplyMax)],
  ];

  const networkRows = bootstrap ? [
    ["Network ID", bootstrap.network],
    ["Genesis", bootstrap.genesis?.slice(0, 16) + "…"],
    ["Tip", bootstrap.tip?.slice(0, 16) + "…"],
    ["Listen", bootstrap.listen],
    ["Peers", bootstrap.peers?.length?.toString() || "0"],
    ["Token", bootstrap.token],
    ["k", bootstrap.k?.toString() || "3"],
    ["Subsidy", fmtKvnc(bootstrap.subsidy)],
    ["Founder Amount", fmtKvnc(bootstrap.founder_amount)],
    ["Finality Depth", bootstrap.finality_depth?.toString() || "—"],
    ["Pruning Depth", bootstrap.payload_pruning_depth?.toString() || "—"],
  ] : [];

  const chainStateRows = state?.node ? [
    ["Selected Tip", state.node.selected_tip?.slice(0, 16) + "…"],
    ["Tips Count", state.node.tips?.length?.toString() || "0"],
    ["Blue Work", fmtNumber(state.node.blue_work || 0)],
    ["Chain Length", fmtNumber(state.node.chain_len || 0)],
    ["UTXO Count", fmtNumber(state.node.utxos || 0)],
    ["Total TXs", fmtNumber(state.node.tx_count || 0)],
    ["Min Fee", fmtKvnc(state.node.min_fee || 0) + "/byte"],
    ["Issuance", fmtKvnc(state.node.issuance || 0)],
    ["Halving Era", state.node.halving_era?.toString() || "0"],
    ["Miner", state.node.authority_pk?.slice(0, 16) + "…" || "—"],
  ] : [];

  const feeFloorRows = [
    ["Subsidy", fmtKvnc(subsidy)],
    ["Divisor", "500,000"],
    ["Fee Floor", fmtKvnc(Math.max(1, Math.floor(subsidy / 500_000))) + "/byte"],
    ["Burn Rate", "75%"],
    ["Producer Share", "25%"],
  ];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div>
          <h2 className="font-display text-2xl font-medium text-foreground">Overview</h2>
          <p className="text-sm text-muted-foreground">Kovanica Testnet — Real-time chain metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={loading ? "warning" : "success"}>
            {loading ? "Loading…" : "Live"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        {statCards.map((card, i) => (
          <StatCard key={i} {...card} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg">RFC-006 Supply Accounting</CardTitle>
            <Badge variant="info">Hard cap: 90.2M KVNC</Badge>
          </CardHeader>
          <CardContent>
            <Table
              headers={["Metric", "Value", "% of Max"]}
              rows={supplyRows}
            />
            <div className="mt-4">
              <div className="h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-kovanica-gold via-kovanica-gold/50 to-kovanica-ok"
                  style={{ width: `${Math.min(percent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {percent.toFixed(4)}% of max supply circulating
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Network Bootstrap</CardTitle>
          </CardHeader>
          <CardContent>
            {networkRows.length > 0 ? (
              <Table headers={["Parameter", "Value"]} rows={networkRows} />
            ) : (
              <p className="text-muted-foreground text-center py-8">Loading bootstrap data…</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Chain State</CardTitle>
          </CardHeader>
          <CardContent>
            {state?.node && (
              <Table
                headers={["Metric", "Value"]}
                rows={chainStateRows}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Fee Floor (RFC-006)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table
              headers={["Parameter", "Value"]}
              rows={feeFloorRows}
            />
          </CardContent>
        </Card>
      </div>

      {/* Additional Network Health Card */}
      {bootstrap && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Network Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Peers Connected</p>
                <p className="text-2xl font-display font-bold text-foreground">{bootstrap.peers?.length || 0}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Authority Threshold</p>
                <p className="text-2xl font-display font-bold text-foreground">{bootstrap.authority_threshold || "—"}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Slot Duration</p>
                <p className="text-2xl font-display font-bold text-foreground">{bootstrap.slot_duration ? `${bootstrap.slot_duration}ms` : "—"}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Finality Depth</p>
                <p className="text-2xl font-display font-bold text-foreground">{bootstrap.finality_depth || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}