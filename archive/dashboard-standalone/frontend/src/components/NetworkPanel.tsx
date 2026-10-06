import { Table, StatCard, Badge } from './ui';
import { Globe, Users, Network, Shield } from 'lucide-react';
import { fmtNumber, fmtKvnc } from '../hooks/useApi';
import type { ApiBootstrap, ApiState } from '../types';

interface NetworkPanelProps {
  bootstrap: ApiBootstrap | null;
  state: ApiState | null;
  loading: boolean;
}

export function NetworkPanel({ bootstrap, state, loading }: NetworkPanelProps) {
  const peers = bootstrap?.peers || [];
  const meshNodes = state?.mesh?.nodes || [];
  const meshEvents = state?.mesh?.events || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-fg">Network / P2P</h2>
          <Badge variant={loading ? 'warn' : 'ok'}>{peers.length} peers</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Connected Peers"
          value={peers.length}
          icon={<Users size={24} className="text-blue" />}
        />
        <StatCard
          label="Mesh Nodes"
          value={meshNodes.length}
          icon={<Network size={24} className="text-teal" />}
        />
        <StatCard
          label="Listen Address"
          value={bootstrap?.listen || '—'}
          trend="P2P port 9000"
          icon={<Globe size={24} className="text-blue" />}
        />
        <StatCard
          label="Network ID"
          value={bootstrap?.network || '—'}
          icon={<Shield size={24} className="text-ok" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Bootstrap Peers</h3>
          </div>
          {peers.length > 0 ? (
            <Table
              headers={['Peer Address']}
              rows={peers.map(p => [p])}
            />
          ) : (
            <p className="text-muted text-center py-8">No peers configured</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Mesh Nodes</h3>
          </div>
          {meshNodes.length > 0 ? (
            <Table
              headers={['Name', 'Blocks', 'Tip', 'Peers', 'Mempool']}
              rows={meshNodes.map(n => [
                n.name,
                fmtNumber(n.blocks),
                n.tip.slice(0, 12) + '…',
                fmtNumber(n.peers),
                fmtNumber(n.mempool),
              ])}
            />
          ) : (
            <p className="text-muted text-center py-8">No mesh data</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Recent Mesh Events</h3>
          </div>
          {meshEvents.length > 0 ? (
            <Table
              headers={['Time', 'From', 'To', 'Kind']}
              rows={meshEvents.slice(-20).reverse().map(e => [
                new Date(e.at).toLocaleTimeString(),
                e.from,
                e.to,
                e.kind,
              ])}
            />
          ) : (
            <p className="text-muted text-center py-8">No mesh events</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Network Config</h3>
          </div>
          <Table
            headers={['Parameter', 'Value']}
            rows={[
              ['Network', bootstrap?.network || '—'],
              ['Genesis', bootstrap?.genesis?.slice(0, 16) + '…' || '—'],
              ['Tip', bootstrap?.tip?.slice(0, 16) + '…' || '—'],
              ['Listen', bootstrap?.listen || '—'],
              ['Token', bootstrap?.token || '—'],
              ['k', bootstrap?.k?.toString() || '3'],
              ['Subsidy', fmtKvnc(bootstrap?.subsidy || 0)],
              ['Finality Depth', bootstrap?.finality_depth?.toString() || '—'],
              ['Pruning Depth', bootstrap?.payload_pruning_depth?.toString() || '—'],
            ]}
          />
        </div>
      </div>
    </div>
  );
}