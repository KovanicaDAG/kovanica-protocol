import React, { useState } from 'react';
import { Card, Table, Loading, Error } from '@console-shared/components';
import { useBlocks } from '@console-shared/hooks/useKovanica';
import { shortenHex, formatKVNC, formatTimestamp } from '@console-shared/utils/format';

interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: string;
  fee: string;
  block_id: string;
  timestamp_ms: number;
  status: 'confirmed' | 'pending';
}

const mockTransactions: Transaction[] = [
  { id: 'tx1', from: 'kvnc1abc...', to: 'kvnc1def...', amount: '10000000000', fee: '200000', block_id: 'block1', timestamp_ms: Date.now() - 3600000, status: 'confirmed' },
  { id: 'tx2', from: 'kvnc1ghi...', to: 'kvnc1jkl...', amount: '5000000000', fee: '150000', block_id: 'block2', timestamp_ms: Date.now() - 7200000, status: 'confirmed' },
  { id: 'tx3', from: 'kvnc1mno...', to: 'kvnc1pqr...', amount: '25000000000', fee: '300000', block_id: 'block3', timestamp_ms: Date.now() - 1800000, status: 'pending' },
];

export function TransactionsPage() {
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const { blocks, loading, error } = useBlocks();

  if (loading) return <Loading message="Loading transactions..." />;
  if (error) return <Error message={error} />;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Transactions</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Recent Transactions</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1 text-sm bg-gray-100 rounded-md hover:bg-gray-200">All</button>
            <button className="px-3 py-1 text-sm bg-gray-100 rounded-md hover:bg-gray-200">Confirmed</button>
            <button className="px-3 py-1 text-sm bg-gray-100 rounded-md hover:bg-gray-200">Pending</button>
          </div>
        </div>
        <Table
          columns={[
            { key: 'id', header: 'Tx ID', render: (tx) => <span className="font-mono text-xs">{shortenHex(tx.id, 8)}</span> },
            { key: 'from', header: 'From', render: (tx) => <span className="font-mono text-xs">{tx.from}</span> },
            { key: 'to', header: 'To', render: (tx) => <span className="font-mono text-xs">{tx.to}</span> },
            { key: 'amount', header: 'Amount', render: (tx) => `${formatKVNC(tx.amount)} KVNC` },
            { key: 'fee', header: 'Fee', render: (tx) => `${formatKVNC(tx.fee)} KVNC` },
            { key: 'status', header: 'Status', render: (tx) => (
              <span className={`px-2 py-1 text-xs rounded-full ${tx.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {tx.status}
              </span>
            )},
            { key: 'time', header: 'Time', render: (tx) => formatTimestamp(tx.timestamp_ms) },
          ]}
          data={mockTransactions}
          keyExtractor={(tx) => tx.id}
          emptyMessage="No transactions found"
          onRowClick={setSelectedTx}
        />
      </Card>

      {selectedTx && (
        <Card title={`Transaction: ${shortenHex(selectedTx.id, 12)}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">From</div>
                <div className="font-mono text-sm">{selectedTx.from}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">To</div>
                <div className="font-mono text-sm">{selectedTx.to}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Amount</div>
                <div className="text-sm font-medium">{formatKVNC(selectedTx.amount)} KVNC</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Fee</div>
                <div className="text-sm">{formatKVNC(selectedTx.fee)} KVNC</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Block</div>
                <div className="font-mono text-sm">{shortenHex(selectedTx.block_id, 12)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <span className={`px-2 py-1 text-xs rounded-full ${selectedTx.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                  {selectedTx.status}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Block Activity">
        <div className="space-y-2">
          {blocks.slice(0, 5).map((block) => (
            <div key={block.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <div>
                <span className="text-sm font-mono">{shortenHex(block.id, 10)}</span>
                <span className="ml-2 text-sm text-gray-500">Height {block.height}</span>
              </div>
              <span className="text-sm text-gray-500">{block.tx_count} txs</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
