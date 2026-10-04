import { useState } from 'react';
import { Input, Button, Badge, Table } from './ui';
import { PanelTabs } from '@/components/ui';
import { Copy, AlertCircle, CheckCircle, Clock, ArrowRight } from 'lucide-react';
import { fmtKvnc } from '../hooks/useApi';
import { postApi } from '../hooks/useApi';

type HtlcPanelProps = Record<string, never>

export function HtlcPanel(_props: HtlcPanelProps) {
  const [step, setStep] = useState<'prepare' | 'redeem' | 'refund'>('prepare');
  const handleStepChange = (id: string) => setStep(id as 'prepare' | 'redeem' | 'refund');
  const [formData, setFormData] = useState({
    sender: '',
    receiver: '',
    amount: '',
    fee: '',
    hashlock: '',
    timelock: '',
    asset_id: '',
  });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (action: string) => {
    setLoading(true);
    try {
      const res = await postApi(`/htlc/${action}/prepare`, formData);
      setResult(res);
    } catch (e) {
      setResult({ error: String(e) });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h2 className="font-display text-2xl font-medium text-fg">HTLC Atomic Swaps (KVP-104)</h2>
        <Badge variant="info">HTLC</Badge>
      </div>

      <PanelTabs
        tabs={[
          { id: 'prepare', label: 'Prepare HTLC' },
          { id: 'redeem', label: 'Redeem' },
          { id: 'refund', label: 'Refund' },
        ]}
        activeTab={step}
        onTabChange={handleStepChange}
      />

      <div className="panel">
        <form onSubmit={e => { e.preventDefault(); handleSubmit(step); }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input
              label="Sender Address"
              value={formData.sender}
              onChange={e => setFormData({ ...formData, sender: e.target.value })}
              placeholder="kvnc..."
            />
            <Input
              label="Receiver Address"
              value={formData.receiver}
              onChange={e => setFormData({ ...formData, receiver: e.target.value })}
              placeholder="kvnc..."
            />
            <Input
              label="Amount (KVNC)"
              type="number"
              value={formData.amount}
              onChange={e => setFormData({ ...formData, amount: e.target.value })}
              placeholder="100000000"
            />
            <Input
              label="Fee (atoms)"
              type="number"
              value={formData.fee}
              onChange={e => setFormData({ ...formData, fee: e.target.value })}
              placeholder="1000"
            />
            <Input
              label="Hashlock (hex)"
              value={formData.hashlock}
              onChange={e => setFormData({ ...formData, hashlock: e.target.value })}
              placeholder="sha256(preimage)"
            />
            <Input
              label="Timelock (blocks)"
              type="number"
              value={formData.timelock}
              onChange={e => setFormData({ ...formData, timelock: e.target.value })}
              placeholder="100"
            />
            <Input
              label="Asset ID (optional)"
              value={formData.asset_id}
              onChange={e => setFormData({ ...formData, asset_id: e.target.value })}
              placeholder="KVNC or asset ID"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" loading={loading} variant={step === 'redeem' ? 'primary' : step === 'refund' ? 'destructive' : 'primary'}>
              {step === 'prepare' ? 'Prepare HTLC' : step === 'redeem' ? 'Redeem' : 'Refund'}
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
        </form>
      </div>

      <div className="panel">
        <h3 className="panel-title">HTLC Flow</h3>
        <ol className="space-y-2 text-sm text-muted list-decimal list-inside">
          <li><strong>Prepare:</strong> Sender creates HTLC output with hashlock + timelock</li>
          <li><strong>Fund:</strong> Sender broadcasts and confirms the prepare transaction</li>
          <li><strong>Redeem:</strong> Receiver reveals preimage, claims funds before timelock</li>
          <li><strong>Refund:</strong> If timelock expires, sender can reclaim funds</li>
        </ol>
      </div>
    </div>
  );
}