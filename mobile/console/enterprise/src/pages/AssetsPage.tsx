import React, { useState } from 'react';
import { Card, Table, Loading, Error } from '../../../shared/src/components';
import { useHead } from '../../../shared/src/hooks/useKovanica';
import { formatKVNC, shortenHex } from '../../../shared/src/utils/format';

interface Asset {
  id: string;
  name: string;
  symbol: string;
  supply: string;
  issuer: string;
  type: 'native' | 'token' | 'nft' | 'rwa';
}

const mockAssets: Asset[] = [
  { id: '0000000000000000000000000000000000000000000000000000000000000000', name: 'KVNC', symbol: 'KVNC', supply: '9020000000000000000', issuer: 'genesis', type: 'native' },
  { id: '1111111111111111111111111111111111111111111111111111111111111111', name: 'Test Token', symbol: 'TEST', supply: '1000000000000', issuer: 'kvnc1abc...', type: 'token' },
];

export function AssetsPage() {
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const { head, loading, error } = useHead();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Assets</h2>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Issued Assets</h3>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            + Issue Asset
          </button>
        </div>
        <Table
          columns={[
            { key: 'name', header: 'Name', render: (a) => a.name },
            { key: 'symbol', header: 'Symbol', render: (a) => <span className="font-mono">{a.symbol}</span> },
            { key: 'type', header: 'Type', render: (a) => <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">{a.type}</span> },
            { key: 'supply', header: 'Supply', render: (a) => formatKVNC(a.supply) },
            { key: 'issuer', header: 'Issuer', render: (a) => <span className="font-mono text-xs">{shortenHex(a.issuer, 8)}</span> },
          ]}
          data={mockAssets}
          keyExtractor={(a) => a.id}
          emptyMessage="No assets found"
        />
      </Card>

      {selectedAsset && (
        <Card title={`Asset: ${selectedAsset.name}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">Asset ID</div>
                <div className="font-mono text-sm">{selectedAsset.id}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Type</div>
                <div className="text-sm">{selectedAsset.type}</div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}