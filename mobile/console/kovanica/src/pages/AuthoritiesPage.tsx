import React from 'react';
import { Card, Loading, Error } from '../../../shared/src/components';
import { useHead } from '../../../shared/src/hooks/useKovanica';
import { shortenHex } from '../../../shared/src/utils/format';

export function AuthoritiesPage() {
  const { head, loading, error, refresh } = useHead();

  if (loading) return <Loading message="Loading authorities..." />;
  if (error) return <Error message={error} onRetry={refresh} />;
  if (!head) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Authorities</h2>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{head.authorities.length}</div>
            <div className="text-sm text-gray-500">Total Authorities</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">2</div>
            <div className="text-sm text-gray-500">Threshold</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{head.finality_depth}</div>
            <div className="text-sm text-gray-500">Finality Depth</div>
          </div>
        </Card>
      </div>

      <Card title="Authority Set">
        <div className="space-y-3">
          {head.authorities.map((auth, i) => (
            <div key={i} className="p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Authority #{i + 1}</span>
                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                  Slot {auth.slot}
                </span>
              </div>
              <div className="font-mono text-xs text-gray-600 break-all">
                {auth.pubkey}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Consensus Parameters">
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Consensus Algorithm</dt>
            <dd className="text-sm">GHOSTDAG (k=3)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Slot Duration</dt>
            <dd className="text-sm">3000 ms</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Threshold</dt>
            <dd className="text-sm">2 of {head.authorities.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Finality Depth</dt>
            <dd className="text-sm">{head.finality_depth} blocks</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
