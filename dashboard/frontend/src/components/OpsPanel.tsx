import { useState } from 'react';
import { Input, Button, Badge, Table, Select, SelectItem, PanelTabs } from '@/components/ui';
import { Trash2 } from 'lucide-react';
import { postApi } from '../hooks/useApi';

interface OpsPanelProps {}

export function OpsPanel({}: OpsPanelProps) {
  const [opsToken, setOpsToken] = useState('');
  const [opsEnabled, setOpsEnabled] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'restart' | 'diagnostics' | 'logs'>('restart');
  const handleActionChange = (id: string) => setSelectedAction(id as 'restart' | 'diagnostics' | 'logs');
  const [targetSeed, setTargetSeed] = useState('seed1');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [auditLog, setAuditLog] = useState<Array<any>>([]);

  const seeds = [
    { id: 'seed1', name: 'Seed 1 (Local)', host: '127.0.0.1', service: 'kovanica-explorer' },
    { id: 'seed2', name: 'Seed 2', host: '76.13.250.65', service: 'kovanica-seed2' },
    { id: 'seed3', name: 'Seed 3', host: '187.7.27.139', service: 'kovanica-seed3' },
  ];

  const handleOpsSubmit = async () => {
    if (!opsToken) {
      setResult({ error: 'Ops token required' });
      return;
    }
    setLoading(true);
    try {
      let res: any;
      if (selectedAction === 'restart') {
        res = await postApi('/ops', { action: 'restart', seed: targetSeed, token: opsToken });
      } else if (selectedAction === 'diagnostics') {
        res = await postApi('/ops', { action: 'diagnostics', seed: targetSeed, token: opsToken });
      } else if (selectedAction === 'logs') {
        res = await postApi('/ops', { action: 'logs', seed: targetSeed, token: opsToken });
      }
      setResult(res);
      setAuditLog(prev => [{ action: selectedAction, seed: targetSeed, time: new Date(), result: res }, ...prev].slice(0, 100));
    } catch (e) {
      setResult({ error: String(e) });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h2 className="font-display text-2xl font-medium text-fg">Operations (Token-Gated)</h2>
        <Badge variant={opsEnabled ? 'ok' : 'danger'}>
          {opsEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Authentication</h3>
        </div>
        <div className="flex items-center gap-4">
          <Input
            label="Ops Token"
            type="password"
            value={opsToken}
            onChange={e => setOpsToken(e.target.value)}
            placeholder="DASHBOARD_OPS_TOKEN"
            className="input w-full sm:w-96 max-w-full"
          />
          <Button onClick={() => setOpsEnabled(!opsEnabled)} variant={opsEnabled ? 'destructive' : 'primary'}>
            {opsEnabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
        {!opsEnabled && (
          <p className="text-muted text-sm mt-2">
            Set DASHBOARD_OPS_TOKEN environment variable on the backend to enable operations.
          </p>
        )}
      </div>

      {opsEnabled && (
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Actions</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <PanelTabs
              tabs={[
                { id: 'restart', label: 'Restart Service' },
                { id: 'diagnostics', label: 'Diagnostics' },
                { id: 'logs', label: 'Fetch Logs' },
              ]}
              activeTab={selectedAction}
              onTabChange={handleActionChange}
            />
            <Select value={targetSeed} onChange={setTargetSeed} className="w-48">
            {seeds.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </Select>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleOpsSubmit} loading={loading} variant={selectedAction === 'restart' ? 'destructive' : 'primary'}>
              {selectedAction === 'restart' ? 'Restart Service' : selectedAction === 'diagnostics' ? 'Run Diagnostics' : 'Fetch Logs'}
            </Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              <Trash2 size={16} /> Clear
            </Button>
          </div>

          {result && (
            <div className="mt-4 p-4 bg-surface-2 border border-border rounded-lg">
              <h4 className="font-medium mb-2">Result</h4>
              <pre className="text-xs text-fg overflow-auto max-h-96 font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Audit Log</h3>
        </div>
        {auditLog.length === 0 ? (
          <p className="text-muted text-center py-8">No operations performed yet</p>
        ) : (
          <Table
            headers={['Time', 'Action', 'Seed', 'Status']}
            rows={auditLog.map(a => [
              a.time.toLocaleTimeString(),
              a.action,
              a.seed,
              a.result?.ok ? 'OK' : a.result?.error || 'Error',
            ])}
          />
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title mb-4">Ops Configuration</h3>
        <Table
          headers={['Setting', 'Value']}
          rows={[
            ['Ops Token', opsEnabled ? '***configured***' : 'Not set'],
            ['Allowed Actions', 'restart, diagnostics, logs'],
            ['Audit Log Path', '/var/lib/kovanica-ops/ops-audit.jsonl'],
            ['Seed 1 Data Dir', '/root/kovanica-data'],
            ['Seed 2 Data Dir', '/var/lib/kovanica-seed2'],
            ['Seed 3 Data Dir', '/var/lib/kovanica-seed3'],
          ]}
        />
      </div>
    </div>
  );
}