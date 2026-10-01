import React from 'react';
import { Card, StatCard, Loading, Error } from '../../../shared/src/components';
import { useHead, useBlocks } from '../../../shared/src/hooks/useKovanica';
import { formatKVNC, shortenHex, formatNumber } from '../../../shared/src/utils/format';

export function ExplorerPage() {
  const { head, loading, error, refresh } = useHead();
  const { blocks } = useBlocks();

  if (loading) return <Loading message="Loading explorer..." />;
  if (error) return <Error message={error} onRetry={refresh} />;
  if (!head) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Block Explorer</h2>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Chain Height" value={formatNumber(head.chain_height)} icon="⛓️" />
        <StatCard label="Block Count" value={formatNumber(head.block_count)} icon="📦" />
        <StatCard
          label="Minted Supply"
          value={`${formatKVNC(head.minted)} KVNC`}
          subValue={`of ${formatKVNC(head.max_supply)} max`}
          icon="🪙"
        />
        <StatCard label="Era" value={`${head.era}`} subValue={`Era length: ${formatNumber(head.era_len)}`} icon="⏳" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Chain Info">
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Genesis</dt>
              <dd className="text-sm font-mono">{shortenHex(head.genesis, 12)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Selected Tip</dt>
              <dd className="text-sm font-mono">{shortenHex(head.selected_tip, 12)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Min Fee</dt>
              <dd className="text-sm">{head.min_fee} atoms/byte</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Finality Depth</dt>
              <dd className="text-sm">{head.finality_depth} blocks</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Subsidy</dt>
              <dd className="text-sm">{formatKVNC(head.subsidy)} KVNC</dd>
            </div>
          </dl>
        </Card>

        <Card title="Authorities">
          <div className="space-y-2">
            {head.authorities.map((auth, i) => (
              <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="text-sm font-mono">{shortenHex(auth.pubkey, 10)}</span>
                <span className="text-sm text-gray-500">Slot {auth.slot}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Recent Blocks">
        <div className="space-y-2">
          {blocks.slice(0, 15).map((block) => (
            <div key={block.id} className="flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer">
              <div>
                <span className="text-sm font-mono">{shortenHex(block.id, 10)}</span>
                <span className="ml-2 text-sm text-gray-500">Height {block.height}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">{block.tx_count} txs</span>
                <span className="text-sm text-gray-400">{block.parents.length} parents</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
