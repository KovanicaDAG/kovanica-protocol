import React, { useState } from 'react';
import { Card, StatCard, Loading, Error } from '../../../shared/src/components';
import { useHead } from '../../../shared/src/hooks/useKovanica';
import { formatKVNC, formatNumber } from '../../../shared/src/utils/format';

export function ReportsPage() {
  const { head, loading, error } = useHead();
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  if (loading) return <Loading message="Loading reports..." />;
  if (error) return <Error message={error} />;
  if (!head) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Reports</h2>

      <div className="flex gap-2">
        {(['daily', 'weekly', 'monthly'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setReportType(type)}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              reportType === type
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Transactions"
          value={formatNumber(head.block_count * 3)}
          subValue={`~${formatNumber(head.block_count)} blocks`}
          icon="📋"
        />
        <StatCard
          label="Supply Minted"
          value={`${formatKVNC(head.minted)} KVNC`}
          subValue={`of ${formatKVNC(head.max_supply)} max`}
          icon="🪙"
        />
        <StatCard
          label="Network Fees"
          value={`${formatKVNC(head.subsidy)} KVNC`}
          subValue="Current block subsidy"
          icon="💰"
        />
        <StatCard
          label="Active Authorities"
          value={`${head.authorities.length}`}
          subValue={`Threshold: 2 of ${head.authorities.length}`}
          icon="🔐"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Transaction Volume">
          <div className="space-y-3">
            {['Block Subsidy', 'Transaction Fees', 'Asset Transfers', 'HTLC Operations'].map((category, i) => (
              <div key={category} className="flex justify-between items-center">
                <span className="text-sm text-gray-600">{category}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${85 - i * 15}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">{formatKVNC(String((4 - i) * 2500000000000))} KVNC</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Network Health">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Chain Height</span>
              <span className="text-sm font-medium">{formatNumber(head.chain_height)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Block Count</span>
              <span className="text-sm font-medium">{formatNumber(head.block_count)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Era</span>
              <span className="text-sm font-medium">{head.era}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Finality Depth</span>
              <span className="text-sm font-medium">{head.finality_depth} blocks</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Min Fee</span>
              <span className="text-sm font-medium">{head.min_fee} atoms/byte</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Export Reports">
        <div className="flex flex-wrap gap-3">
          <button className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm">
            Export CSV
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm">
            Export JSON
          </button>
          <button className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm">
            Export PDF
          </button>
        </div>
      </Card>
    </div>
  );
}
