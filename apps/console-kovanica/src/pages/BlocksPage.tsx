import React, { useState } from 'react';
import { Card, Table, Loading, Error } from '@console-shared/components';
import { useBlocks } from '@console-shared/hooks/useKovanica';
import { shortenHex, formatTimestamp } from '@console-shared/utils/format';

export function BlocksPage() {
  const { blocks, loading, error, refresh } = useBlocks();
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);

  if (loading) return <Loading message="Loading blocks..." />;
  if (error) return <Error message={error} onRetry={refresh} />;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Blocks</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">All Blocks</h3>
          <span className="text-sm text-gray-500">{blocks.length} blocks</span>
        </div>
        <Table
          columns={[
            { key: 'id', header: 'Block ID', render: (b) => <span className="font-mono text-xs">{shortenHex(b.id, 10)}</span> },
            { key: 'height', header: 'Height', render: (b) => b.height },
            { key: 'tx_count', header: 'Transactions', render: (b) => b.tx_count },
            { key: 'parents', header: 'Parents', render: (b) => b.parents.length },
            { key: 'timestamp', header: 'Time', render: (b) => formatTimestamp(b.timestamp_ms) },
          ]}
          data={blocks}
          keyExtractor={(b) => b.id}
          emptyMessage="No blocks found"
          onRowClick={(b) => setSelectedBlock(b.id === selectedBlock ? null : b.id)}
        />
      </Card>

      {selectedBlock && (
        <Card title={`Block: ${shortenHex(selectedBlock, 12)}`}>
          <div className="space-y-4">
            {blocks.filter((b) => b.id === selectedBlock).map((block) => (
              <div key={block.id} className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-500">Block ID</div>
                    <div className="font-mono text-sm break-all">{block.id}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Height</div>
                    <div className="text-sm font-medium">{block.height}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Timestamp</div>
                    <div className="text-sm">{formatTimestamp(block.timestamp_ms)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Transactions</div>
                    <div className="text-sm">{block.tx_count}</div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-2">Parent Blocks</div>
                  <div className="space-y-1">
                    {block.parents.map((parent, i) => (
                      <div key={i} className="font-mono text-xs bg-gray-50 p-2 rounded">
                        {shortenHex(parent, 16)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
