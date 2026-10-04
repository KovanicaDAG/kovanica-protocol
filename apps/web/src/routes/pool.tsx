import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { Activity, Users, Pickaxe, Hash } from "lucide-react";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/pool")({ component: PoolPage });

function PoolPage() {
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const res = await fetch("https://pool.kovanica.online/api/stats");
        if (res.ok) {
          const data = await res.json();
          if (mounted) setStats(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Shell>
      <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="font-display text-3xl tracking-tight text-fg md:text-4xl">
            Kovanica Mining Pool
          </h1>
          <p className="text-muted text-sm md:text-base">
            High-performance Blake3 Stratum Pool running natively in Go.
          </p>
        </div>

        {/* Stratum Connect Box */}
        <div className="mb-8 rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Pickaxe className="text-blue size-6" />
            <h2 className="text-xl font-semibold text-fg">Connect your miner</h2>
          </div>
          <div className="rounded-md bg-surface-2 p-4 flex flex-col md:flex-row items-center gap-4">
            <code className="text-green-400 font-mono text-sm md:text-lg flex-1 overflow-x-auto">
              stratum+tcp://pool.kovanica.online:3333
            </code>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Workers"
            value={isLoading ? "-" : stats?.activeWorkers || 0}
            icon={Users}
            color="text-indigo-400"
          />
          <StatCard
            title="Total Shares"
            value={isLoading ? "-" : stats?.totalShares || 0}
            icon={Activity}
            color="text-sky-400"
          />
          <StatCard
            title="Pool Hashrate"
            value={isLoading ? "-" : (stats?.poolHashrate || 0) + " MH/s"}
            icon={Hash}
            color="text-emerald-400"
          />
          <StatCard
            title="Pool Fee"
            value={isLoading ? "-" : (stats?.poolFee || 1.0) + "%"}
            icon={Pickaxe}
            color="text-amber-400"
          />
        </div>
      </div>
    </Shell>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: any; icon: any; color: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6 shadow-sm transition-all hover:bg-surface-2">
      <div className="flex items-center gap-2 text-muted text-sm font-medium uppercase tracking-wider">
        <Icon className={"size-5 " + color} />
        {title}
      </div>
      <div className={"font-display text-3xl font-semibold tracking-tight " + color}>
        {value}
      </div>
    </div>
  );
}
