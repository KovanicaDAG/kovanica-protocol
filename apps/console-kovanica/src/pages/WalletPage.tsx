import React, { useState } from 'react';
import { Card, Loading, Error } from '@console-shared/components';
import { useBalance, useHistory } from '@console-shared/hooks/useKovanica';
import { formatKVNC, shortenHex, formatTimestamp } from '@console-shared/utils/format';

export function WalletPage() {
  const [address, setAddress] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const { balance, loading, error } = useBalance(searchAddress || null);
  const { history } = useHistory(searchAddress || null);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Wallet</h2>

      <Card title="Address Lookup">
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter Kovanica address..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-md text-sm font-mono"
            />
            <button
              onClick={() => setSearchAddress(address)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              Lookup
            </button>
          </div>
        </div>
      </Card>

      {searchAddress && (
        <>
          <Card title="Balance">
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
                <div className="text-xs text-gray-400 font-mono break-all">
                  {balance.address}
                </div>
              </div>
            ) : null}
          </Card>

          <Card title="Transaction History">
            <div className="space-y-2">
              {history.length === 0 ? (
                <p className="text-sm text-gray-500">No transactions found</p>
              ) : (
                history.slice(0, 20).map((entry, i) => (
                  <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                    <div>
                      <span className={`text-sm font-medium ${entry.direction === 'Received' ? 'text-green-600' : 'text-red-600'}`}>
                        {entry.direction === 'Received' ? '+' : '-'}{formatKVNC(entry.amount)} KVNC
                      </span>
                      <div className="text-xs text-gray-400 font-mono">
                        {shortenHex(entry.tx_id, 8)}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatTimestamp(Date.now())}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
