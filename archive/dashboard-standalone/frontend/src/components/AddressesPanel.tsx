import { useState } from 'react';
import { Table } from '@/components/ui';
import { Badge } from '@/components/ui';
import { PanelTabs } from '@/components/ui';
import { Button } from '@/components/ui';
import { Search } from 'lucide-react';
import { fmtKvnc } from '../hooks/useApi';
import type { ApiState } from '../types';

interface AddressesPanelProps {
  state: ApiState | null;
  loading: boolean;
}

export function AddressesPanel({ state, loading }: AddressesPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const wallets = state?.wallets || [];

  const filteredWallets = wallets.filter(w =>
    w.address.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-fg">Addresses</h2>
          <Badge variant={loading ? 'warn' : 'ok'}>{wallets.length} wallets</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <input
              type="text"
              placeholder="Search addresses…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-8 w-full sm:w-64 max-w-full"
            />
          </div>
        </div>
      </div>

      <PanelTabs
        tabs={[
          { id: 'wallets', label: 'Wallets' },
          { id: 'utxos', label: 'UTXO Set' },
        ]}
        activeTab="wallets"
        onTabChange={() => {}}
      />

      <div className="panel">
        <Table
          headers={['Address', 'Seed', 'Balance', 'Actions']}
          rows={filteredWallets.map(w => [
            w.address.slice(0, 16) + '…',
            w.seed.toString(),
            fmtKvnc(w.balance),
            '',
          ])}
        />
      </div>

      {selectedAddress && (
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 min-w-0">
            <h3 className="font-display font-medium">UTXOs for {selectedAddress.slice(0, 16)}…</h3>
            <Button variant="ghost" size="sm" onClick={() => setSelectedAddress(null)}>Close</Button>
          </div>
          <p className="text-muted">UTXO detail view - connect to /api/utxos endpoint for full data</p>
        </div>
      )}
    </div>
  );
}