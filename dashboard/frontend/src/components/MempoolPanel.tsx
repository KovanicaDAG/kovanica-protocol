import React from 'react';
import { Table } from '@/components/ui';
import { Badge } from '@/components/ui';
import { PanelTabs } from '@/components/ui';
import { StatCard } from '@/components/ui';
import { Activity, Clock, AlertCircle } from 'lucide-react';
import { fmtNumber, fmtKvnc } from '../hooks/useApi';
import type { ApiState } from '../types';

interface MempoolPanelProps {
  state: ApiState | null;
  loading: boolean;
}

export function MempoolPanel({ state, loading }: MempoolPanelProps) {
  const mempoolCount = state?.node?.mempool || 0;
  const mempoolBytes = 0; // Not directly exposed, could estimate
  const txCount = state?.node?.tx_count || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-fg">Mempool</h2>
          <Badge variant={loading ? 'warn' : 'ok'}>Live</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Pending TXs"
          value={fmtNumber(mempoolCount)}
          icon={<Activity size={24} className="text-gold" />}
        />
        <StatCard
          label="Total TXs (chain)"
          value={fmtNumber(txCount)}
          icon={<Clock size={24} className="text-blue" />}
        />
        <StatCard
          label="Mempool Size"
          value={`~${fmtNumber(mempoolCount * 500)} bytes`}
          trend="Estimated"
          icon={<AlertCircle size={24} className="text-muted" />}
        />
        <StatCard
          label="Fee Estimate"
          value="Check Fee Estimate panel"
          icon={<Activity size={24} className="text-gold" />}
        />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Mempool Status</h3>
        </div>
        <Table
          headers={['Metric', 'Value']}
          rows={[
            ['Pending Transactions', fmtNumber(mempoolCount)],
            ['Estimated Size', '~' + fmtNumber(mempoolCount * 500) + ' bytes'],
            ['Total Chain TXs', fmtNumber(txCount)],
            ['Orphan TXs', 'N/A (not exposed)'],
            ['Max Mempool Size', 'N/A (not exposed)'],
          ]}
        />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Recent Mempool Activity</h3>
        </div>
        <p className="text-muted text-center py-8">
          Connect WebSocket to receive real-time 'tx' messages for live mempool monitoring.
          Use the API Console to call <code className="font-mono bg-surface-2 px-1 rounded">/api/state</code> for current mempool count.
        </p>
      </div>
    </div>
  );
}