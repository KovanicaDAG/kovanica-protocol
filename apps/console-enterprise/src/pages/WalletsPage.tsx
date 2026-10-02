import React, { useState } from 'react';
import { Card, Table, Loading, Error } from '../../../shared/src/components';
import { useBalance } from '../../../shared/src/hooks/useKovanica';
import { formatKVNC, shortenHex } from '../../../shared/src/utils/format';

interface Wallet {
  id: string;
  name: string;
  address: string;
  balance: string;
  type: 'business' | 'treasury' | 'user';
}

const mockWallets: Wallet[] = [
  { id: '1', name: 'Main Business Wallet', address: 'kvnc1abc...', balance: '1000000000000', type: 'business' },
  { id: '2', name: 'Treasury', address: 'kvnc1def...', balance: '5000000000000', type: 'treasury' },
  { id: '3', name: 'User Payments', address: 'kvnc1ghi...', balance: '250000000000', type: 'user' },
];

export function WalletsPage() {
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const { balance, loading, error } = useBalance(selectedWallet?.address || null);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Wallets</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Business Wallets</h3>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            + Add Wallet
          </button>
        </div>
        <Table
          columns={[
            { key: 'name', header: 'Name', render: (w) => w.name },
            { key: 'address', header: 'Address', render: (w) => <span className="font-mono text-xs">{shortenHex(w.address, 8)}</span> },
            { key: 'type', header: 'Type', render: (w) => <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">{w.type}</span> },
            { key: 'balance', header: 'Balance', render: (w) => `${formatKVNC(w.balance)} KVNC` },
          ]}
          data={mockWallets}
          keyExtractor={(w) => w.id}
          emptyMessage="No wallets found"
        />
      </Card>

      {selectedWallet && (
        <Card title={`Wallet: ${selectedWallet.name}`}>
          {loading ? (
            <Loading message="Loading balance..." />
          ) : error ? (
            <Error message={error} />
          ) : balance ? (
            <div className="space-y-4">
              <div className="text-3xl font-bold text-gray-900">
                {formatKVNC(balance.balance)} KVNC
              </div>
              <div className="text-sm text-gray-500">
                {balance.utxos.length} UTXOs
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}