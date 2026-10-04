import React from 'react';
import { Card, Loading, Error } from '@console-shared/components';
import { useHead } from '@console-shared/hooks/useKovanica';
import { formatNumber } from '@console-shared/utils/format';

export function PeersPage() {
  const { head, loading, error, refresh } = useHead();

  if (loading) return <Loading message="Loading peers..." />;
  if (error) return <Error message={error} onRetry={refresh} />;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Network Peers</h2>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{head?.block_count || 0}</div>
            <div className="text-sm text-gray-500">Blocks Synced</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{head?.authorities.length || 0}</div>
            <div className="text-sm text-gray-500">Authorities</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{head?.era || 0}</div>
            <div className="text-sm text-gray-500">Current Era</div>
          </div>
        </Card>
      </div>

      <Card title="Known Peers">
        <div className="space-y-3">
          {[
            { address: 'seed.kovanica.online:9000', status: 'connected', latency: '12ms' },
            { address: 'seed2.kovanica.online:9000', status: 'connected', latency: '45ms' },
            { address: 'seed3.kovanica.online:9000', status: 'connected', latency: '78ms' },
          ].map((peer, i) => (
            <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${peer.status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="font-mono text-sm">{peer.address}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">{peer.latency}</span>
                <span className={`px-2 py-1 text-xs rounded-full ${peer.status === 'connected' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {peer.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="P2P Configuration">
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Listen Address</dt>
            <dd className="text-sm font-mono">0.0.0.0:9000</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Protocol</dt>
            <dd className="text-sm">TCP (plaintext)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Max Peers</dt>
            <dd className="text-sm">128</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Sync Interval</dt>
            <dd className="text-sm">10 seconds</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
