import { useState } from 'react';
import { Input, Button, Badge } from './ui';
import { Copy, AlertCircle, CheckCircle } from 'lucide-react';
import { postApi } from '../hooks/useApi';
import type { ApiState } from '../types';

interface FaucetPanelProps {
  state: ApiState | null;
  loading: boolean;
}

export function FaucetPanel({ state, loading: _loading }: FaucetPanelProps) {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loadingFaucet, setLoadingFaucet] = useState(false);

  const handleFaucet = async () => {
    if (!address) return;
    setLoadingFaucet(true);
    try {
      const res = await postApi('/faucet', { address });
      setResult(res);
    } catch (e) {
      setResult({ error: String(e) });
    }
    setLoadingFaucet(false);
  };

  const faucetEnabled = state?.faucet || false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h2 className="font-display text-2xl font-medium text-fg">Faucet (Testnet Only)</h2>
        <Badge variant={faucetEnabled ? 'ok' : 'danger'}>
          {faucetEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Request Testnet KVNC</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              label="Address"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="kvnc1... or kvnc..."
              className="input w-full sm:w-96 max-w-full"
            />
            <Button onClick={handleFaucet} loading={loadingFaucet} disabled={!faucetEnabled || !address}>
              Request 5 KVNC
            </Button>
          </div>

          {result && (
            <div className={`p-4 rounded-lg ${result.ok ? 'bg-ok/10 border border-ok' : 'bg-danger/10 border border-danger'}`}>
              <h4 className="font-medium mb-2">{result.ok ? 'Success' : 'Error'}</h4>
              <pre className="text-xs font-mono">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          {!faucetEnabled && (
            <p className="text-danger text-sm">
              Faucet is disabled on this node. Enable with KOVANICA_FAUCET=1 (testnet only).
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title mb-4">Faucet Rules</h3>
        <ul className="space-y-2 text-sm text-muted list-disc list-inside">
          <li>Testnet only — disabled on mainnet</li>
          <li>5 KVNC per address (500,000,000 atoms)</li>
          <li>Rate limited per IP</li>
          <li>Requires KOVANICA_FAUCET=1 and KOVANICA_NETWORK=kovanica-testnet</li>
        </ul>
      </div>
    </div>
  );
}