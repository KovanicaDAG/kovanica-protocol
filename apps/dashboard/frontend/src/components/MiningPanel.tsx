import { useState } from 'react';
import { Input, Button, Badge, Table, StatCard } from './ui';
import { PanelTabs } from '@/components/ui';
import { Pickaxe, Zap, Cpu, Database } from 'lucide-react';
import { fmtKvnc, fmtNumber } from '../hooks/useApi';
import { postApi } from '../hooks/useApi';
import type { ApiState } from '../types';

interface MiningPanelProps {
  state: ApiState | null;
  loading: boolean;
}

export function MiningPanel({ state, loading: _loading }: MiningPanelProps) {
  const [action, setAction] = useState<'mine' | 'produce' | 'submit'>('mine');
  const handleActionChange = (id: string) => setAction(id as 'mine' | 'produce' | 'submit');
  const [formData, setFormData] = useState({
    block: '',
    nonce: '',
  });
  const [result, setResult] = useState<any>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const miningEnabled = state?.mining || false;
  const operatorEnabled = state?.operator || false;

  const handleSubmit = async () => {
    setLoadingAction(true);
    try {
      let res;
      if (action === 'mine') {
        res = await postApi('/mine', {});
      } else if (action === 'produce') {
        res = await postApi('/produce', {});
      } else if (action === 'submit') {
        res = await postApi('/mine/submit', formData);
      }
      setResult(res);
    } catch (e) {
      setResult({ error: String(e) });
    }
    setLoadingAction(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h2 className="font-display text-2xl font-medium text-fg">Mining & Block Production</h2>
        <Badge variant={miningEnabled ? 'ok' : 'warn'}>
          {miningEnabled ? 'Mining Active' : 'Mining Disabled'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Mining"
          value={miningEnabled ? 'Active' : 'Inactive'}
          icon={<Pickaxe size={24} className="text-gold" />}
        />
        <StatCard
          label="Operator Mode"
          value={operatorEnabled ? 'Enabled' : 'Disabled'}
          icon={<Zap size={24} className="text-blue" />}
        />
        <StatCard
          label="Producing"
          value={state?.node?.miner || '—'}
          icon={<Cpu size={24} className="text-teal" />}
        />
        <StatCard
          label="Chain Height"
          value={fmtNumber(state?.node?.blocks || 0)}
          icon={<Database size={24} className="text-blue" />}
        />
      </div>

      <PanelTabs
        tabs={[
          { id: 'mine', label: 'Mine Block' },
          { id: 'produce', label: 'Produce (PoA)' },
          { id: 'submit', label: 'Submit Block' },
        ]}
        activeTab={action}
        onTabChange={handleActionChange}
      />

      <div className="panel">
        <form onSubmit={e => { e.preventDefault(); handleSubmit(); }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {action === 'submit' && (
              <>
                <Input
                  label="Block Hex"
                  value={formData.block}
                  onChange={e => setFormData({ ...formData, block: e.target.value })}
                  placeholder="Serialized block hex"
                  className="md:col-span-2"
                />
                <Input
                  label="Nonce"
                  value={formData.nonce}
                  onChange={e => setFormData({ ...formData, nonce: e.target.value })}
                  placeholder="Nonce value"
                />
              </>
            )}
            {(action === 'mine' || action === 'produce') && (
              <p className="text-muted col-span-2">
                Click the button to trigger block {action === 'mine' ? 'mining' : 'production'}.
                Requires KOVANICA_MINE=1 or KOVANICA_PRODUCE=1 and operator privileges.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" loading={loadingAction} variant="primary" disabled={!operatorEnabled && (action === 'mine' || action === 'produce')}>
              {action === 'mine' ? 'Start Mining' : action === 'produce' ? 'Produce Block' : 'Submit Block'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setResult(null)}>Clear</Button>
          </div>

          {result && (
            <div className="mt-4 p-4 bg-surface-2 border border-border rounded-lg">
              <h4 className="font-medium mb-2">Result</h4>
              <pre className="text-xs text-fg overflow-auto max-h-64 font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          {!operatorEnabled && (action === 'mine' || action === 'produce') && (
            <p className="text-danger text-sm mt-2">
              Operator mode required. Set KOVANICA_OPERATOR=1 and restart node.
            </p>
          )}
        </form>
      </div>

      <div className="panel">
        <h3 className="panel-title">Mining Info</h3>
        <Table
          headers={['Parameter', 'Value']}
          rows={[
            ['KOVANICA_MINE', miningEnabled ? '1' : '0'],
            ['KOVANICA_PRODUCE', operatorEnabled ? '1' : '0'],
            ['Current Miner', state?.node?.miner || '—'],
            ['Subsidy', fmtKvnc(state?.node?.subsidy || 0)],
            ['Min Fee', fmtKvnc(state?.node?.min_fee || 0) + '/byte'],
            ['Difficulty', 'PoA (no PoW difficulty)'],
          ]}
        />
      </div>
    </div>
  );
}