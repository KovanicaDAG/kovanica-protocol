import React, { useState } from 'react';
import { Card, Table, Loading, Error } from '@console-shared/components';
import { useBlocks } from '@console-shared/hooks/useKovanica';
import { shortenHex, formatKVNC, formatTimestamp } from '@console-shared/utils/format';

export function TransactionsPage() {
  const { blocks, loading, error, refresh } = useBlocks();
  const [searchQuery, setSearchQuery] = useState('');

  if (loading) return <Loading message="Loading transactions..." />;
  if (error) return <Error message={error} onRetry={refresh} />;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Transactions</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Recent Transactions</h3>
          <input
            type="text"
            placeholder="Search by tx ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1 border rounded-md text-sm w-64"
          />
        </div>
        <div className="space-y-2">
          {blocks.slice(0, 10).map((block) => (
            <div key={block.id} className="p-3 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-mono">{shortenHex(block.id, 10)}</span>
                <span className="text-sm text-gray-500">{block.tx_count} transactions</span>
              </div>
              <div className="text-xs text-gray-400">
                Height {block.height} - {formatTimestamp(block.timestamp_ms)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Transaction Lookup">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Transaction ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter transaction ID..."
                className="flex-1 px-3 py-2 border rounded-md text-sm"
              />
              <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">
                Lookup
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Enter a transaction ID to view its inputs, outputs, fees, and confirmation status.
          </p>
        </div>
      </Card>
    </div>
  );
}
