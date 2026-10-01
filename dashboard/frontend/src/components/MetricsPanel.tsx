import { useState, useEffect } from 'react';
import { Table, StatCard, Badge, Button } from './ui';
import { PanelTabs } from '@/components/ui';
import { BarChart2, RefreshCw, ExternalLink } from 'lucide-react';
import { fmtNumber } from '../hooks/useApi';

interface MetricsPanelProps {}

export function MetricsPanel({}: MetricsPanelProps) {
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string>('kovanica');

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/metrics');
      if (res.ok) {
        const text = await res.text();
        const parsed: Record<string, string> = {};
        text.split('\n').forEach(line => {
          if (line && !line.startsWith('#')) {
            const idx = line.indexOf(' ');
            if (idx > 0) {
              parsed[line.slice(0, idx)] = line.slice(idx + 1);
            }
          }
        });
        setMetrics(parsed);
      }
    } catch (e) {
      console.error('Failed to fetch metrics', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, 10000);
    return () => clearInterval(id);
  }, []);

  const kovanicaMetrics = Object.entries(metrics)
    .filter(([k]) => k.startsWith('kovanica_'))
    .sort(([a], [b]) => a.localeCompare(b));

  const otherMetrics = Object.entries(metrics)
    .filter(([k]) => !k.startsWith('kovanica_'))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h2 className="font-display text-2xl font-medium text-fg">Prometheus Metrics</h2>
        <div className="flex items-center gap-2">
          <Badge variant={loading ? 'warn' : 'ok'}>{loading ? 'Loading…' : 'Live'}</Badge>
          <Button variant="ghost" size="sm" onClick={fetchMetrics} loading={loading}>
            <RefreshCw size={16} />
          </Button>
          <a href="http://145.223.116.178:19080" target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <ExternalLink size={16} /> Grafana
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="kovanica_block_height" value={metrics['kovanica_block_height'] || '—'} icon={<BarChart2 size={24} className="text-blue" />} />
        <StatCard label="kovanica_dag_blue_score" value={metrics['kovanica_dag_blue_score'] || '—'} icon={<BarChart2 size={24} className="text-gold" />} />
        <StatCard label="kovanica_peer_count" value={metrics['kovanica_peer_count'] || '—'} icon={<BarChart2 size={24} className="text-teal" />} />
        <StatCard label="kovanica_mempool_tx_count" value={metrics['kovanica_mempool_tx_count'] || '—'} icon={<BarChart2 size={24} className="text-gold" />} />
      </div>

      <PanelTabs
        tabs={[
          { id: 'kovanica', label: 'Kovanica Metrics' },
          { id: 'all', label: 'All Metrics' },
        ]}
        activeTab={selectedJob}
        onTabChange={setSelectedJob}
      />

      <div className="panel overflow-auto max-h-[60vh]">
        <Table
          headers={['Metric', 'Value']}
          rows={selectedJob === 'kovanica' ? kovanicaMetrics : otherMetrics}
        />
      </div>

      <div className="panel">
        <h3 className="panel-title mb-4">Key Metrics Reference</h3>
        <Table
          headers={['Metric', 'Description']}
          rows={[
            ['kovanica_block_height', 'Current chain height'],
            ['kovanica_dag_blue_score', 'GHOSTDAG blue score'],
            ['kovanica_peer_count', 'Connected P2P peers'],
            ['kovanica_mempool_tx_count', 'Pending transactions'],
            ['kovanica_mempool_bytes', 'Mempool size in bytes'],
            ['kovanica_mempool_orphan_count', 'Orphan transactions'],
            ['kovanica_supply_minted', 'Total native minted (atoms)'],
            ['kovanica_supply_total', 'Total supply (minted - burned)'],
            ['kovanica_supply_circulating', 'Circulating supply'],
            ['kovanica_supply_burned', 'Total burned (75% fees)'],
            ['kovanica_supply_max', 'Hard cap (90.2M KVNC)'],
            ['kovanica_supply_subsidy', 'Current block subsidy'],
            ['kovanica_block_rate_5m', 'Blocks per 5 minutes'],
            ['kovanica_block_rejection_rate_5m', 'Rejected blocks per 5 min'],
            ['kovanica_block_production_duration_seconds', 'Block production latency'],
            ['kovanica_block_validation_duration_seconds', 'Block validation latency'],
            ['kovanica_tx_validation_duration_seconds', 'TX validation latency'],
            ['kovanica_explorer_http_requests_total', 'Explorer HTTP requests'],
            ['kovanica_explorer_ws_clients', 'WebSocket clients'],
          ]}
        />
      </div>
    </div>
  );
}