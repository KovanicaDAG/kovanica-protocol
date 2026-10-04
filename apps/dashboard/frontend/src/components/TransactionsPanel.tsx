import { useState, useMemo } from 'react';
import { Table } from '@/components/ui';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtKvnc, fmtNumber } from '../hooks/useApi';
import type { ApiState, ApiDagTx } from '../types';

interface TransactionsPanelProps {
  state: ApiState | null;
  loading: boolean;
}

/**
 * A transaction lifted out of the DAG payload, with the block it was found in.
 *
 * Built from `/api/state` rather than `/api/history`, which is per-address. Note
 * what the node does and does not expose here: `inputs` is a COUNT, not a list
 * of valued outpoints, and there is no fee field. So fee and per-input amounts
 * are not derivable from this payload, and this panel deliberately shows only
 * what the node actually reports rather than fabricating zeros.
 */
type TxRow = ApiDagTx & {
  blockPos: number;
  blockId: string;
  timestamp: number;
  totalOutput: number;
  outputCount: number;
};

export function TransactionsPanel({ state, loading }: TransactionsPanelProps) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [sortBy, _setSortBy] = useState<'timestamp' | 'output' | 'pos'>('pos');
  const [sortDir, _setSortDir] = useState<'asc' | 'desc'>('desc');

  const allTxs = useMemo(() => {
    const txs: TxRow[] = [];
    (state?.node?.dag || []).forEach((block, i) => {
      block.txs.forEach(tx => {
        const outputs = tx.outputs || [];
        txs.push({
          ...tx,
          blockPos: i + 1,
          blockId: block.id,
          timestamp: block.timestamp_ms,
          totalOutput: outputs.reduce((sum, o) => sum + (o.value || 0), 0),
          outputCount: outputs.length,
        });
      });
    });
    return txs;
  }, [state?.node?.dag]);

  const filteredTxs = useMemo(() => {
    let result = [...allTxs];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(t =>
        t.id.toLowerCase().includes(s) ||
        t.blockPos.toString().includes(s) ||
        t.blockId.toLowerCase().includes(s)
      );
    }
    result.sort((a, b) => {
      const getVal = (tx: TxRow, key: string): string | number => {
        switch (key) {
          case 'timestamp': return tx.timestamp;
          case 'output': return tx.totalOutput;
          case 'pos': return tx.blockPos;
          default: return '';
        }
      };
      const av = getVal(a, sortBy);
      const bv = getVal(b, sortBy);
      if (typeof av === 'string' && typeof bv === 'string') {
        const aLow = av.toLowerCase();
        const bLow = bv.toLowerCase();
        if (aLow < bLow) return sortDir === 'asc' ? -1 : 1;
        if (aLow > bLow) return sortDir === 'asc' ? 1 : -1;
        return 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [allTxs, search, sortBy, sortDir]);

  const totalPages = Math.ceil(filteredTxs.length / pageSize);
  const paginatedTxs = filteredTxs.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-fg">Transactions</h2>
          <Badge variant={loading ? 'warn' : 'ok'}>{allTxs.length} transactions</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <input
              type="text"
              placeholder="Search transactions…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="input pl-8 w-full sm:w-64 max-w-full"
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <Table
          headers={['Block', 'TX ID', 'Type', 'In', 'Out', 'Total Output', 'Time']}
          rows={paginatedTxs.map(t => [
            fmtNumber(t.blockPos),
            t.id.slice(0, 16) + '…',
            t.coinbase ? 'Coinbase' : 'Transfer',
            t.inputs,
            t.outputCount,
            fmtKvnc(t.totalOutput),
            new Date(t.timestamp).toLocaleString(),
          ])}
        />
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={16} /></Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight size={16} /></Button>
        </div>
      )}
    </div>
  );
}