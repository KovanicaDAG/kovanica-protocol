import React, { useState, useMemo } from 'react';
import { Input, Button, Badge, Table } from './ui';
import { Play, Trash2, Copy, Download } from 'lucide-react';
import { postApi } from '../hooks/useApi';

const ENDPOINT_CATALOG = [
  { method: 'GET', path: '/head', note: 'Chain tip & supply', read: true },
  { method: 'GET', path: '/bootstrap', note: 'Full bootstrap info', read: true },
  { method: 'GET', path: '/state', note: 'Full node state (dag, mesh, wallets)', read: true },
  { method: 'GET', path: '/network', note: 'Network config', read: true },
  { method: 'GET', path: '/p2p', note: 'P2P peer info', read: true },
  { method: 'GET', path: '/origins', note: 'Pulse origins', read: true },
  { method: 'GET', path: '/blocks', note: 'Block dump (octet-stream)', read: true },
  { method: 'GET', path: '/light_sync', note: 'Light sync data', read: true },
  { method: 'GET', path: '/light_proof', note: 'Light proof', read: true },
  { method: 'GET', path: '/history', note: 'Address history', read: true, params: '?address=&limit=100&offset=0' },
  { method: 'GET', path: '/utxos', note: 'Address UTXOs', read: true, params: '?address=&limit=100&offset=0' },
  { method: 'GET', path: '/block/{id}', note: 'Block by ID', read: true },
  { method: 'GET', path: '/tx/{id}', note: 'Transaction by ID', read: true },
  { method: 'GET', path: '/address/{addr}', note: 'Address info', read: true, params: '?page=1&per_page=20' },
  { method: 'GET', path: '/nft/{id}', note: 'NFT by ID', read: true },
  { method: 'GET', path: '/rwa/{id}', note: 'RWA by ID', read: true },
  { method: 'GET', path: '/collection/{id}', note: 'Collection by ID', read: true },
  { method: 'GET', path: '/dex/tokens', note: 'DEX token list', read: true },
  { method: 'GET', path: '/token/{id}', note: 'Token by ID', read: true },
  { method: 'GET', path: '/fee_estimate', note: 'Fee estimates', read: true },
  { method: 'POST', path: '/prepare', note: 'Prepare transaction', read: false, body: '{"address":"","amount":100000000,"fee":1000}' },
  { method: 'POST', path: '/submit', note: 'Submit signed tx', read: false, body: '{"tx":"..."}' },
  { method: 'POST', path: '/mine/submit', note: 'Submit mined block', read: false, body: '{"block":"...","nonce":0}' },
  { method: 'POST', path: '/multisig/create', note: 'Create multisig', read: false, body: '{"m":2,"n":3,"pubkeys":[]}' },
  { method: 'POST', path: '/multisig/build', note: 'Build multisig tx', read: false, body: '{"script":"","amount":0,"fee":0,"receiver":""}' },
  { method: 'POST', path: '/multisig/sign', note: 'Sign multisig', read: false, body: '{"tx":"...","key":"..."}' },
  { method: 'POST', path: '/multisig/combine', note: 'Combine signatures', read: false, body: '{"tx":"...","signatures":[]}' },
  { method: 'POST', path: '/multisig/submit', note: 'Submit multisig', read: false, body: '{"tx":"..."}' },
  { method: 'POST', path: '/htlc/prepare', note: 'Prepare HTLC', read: false, body: '{"sender":"","receiver":"","amount":0,"fee":0,"hashlock":"","timelock":0}' },
  { method: 'POST', path: '/htlc/submit', note: 'Submit HTLC', read: false, body: '{"tx":"..."}' },
  { method: 'POST', path: '/htlc/redeem/prepare', note: 'Prepare HTLC redeem', read: false, body: '{"tx":"...","preimage":"..."}' },
  { method: 'POST', path: '/htlc/redeem/submit', note: 'Submit HTLC redeem', read: false, body: '{"tx":"..."}' },
  { method: 'POST', path: '/htlc/refund/prepare', note: 'Prepare HTLC refund', read: false, body: '{"tx":"..."}' },
  { method: 'POST', path: '/htlc/refund/submit', note: 'Submit HTLC refund', read: false, body: '{"tx":"..."}' },
  { method: 'POST', path: '/faucet', note: 'Request faucet (testnet)', read: false, body: '{"address":""}' },
  { method: 'POST', path: '/mine', note: 'Trigger mining', read: false, body: '{}' },
  { method: 'POST', path: '/produce', note: 'Trigger PoA produce', read: false, body: '{}' },
  { method: 'POST', path: '/coinjoin_prepare', note: 'Prepare coinjoin', read: false, body: '{}' },
  { method: 'POST', path: '/coinjoin_submit', note: 'Submit coinjoin', read: false, body: '{}' },
  { method: 'POST', path: '/rwa/derive', note: 'Derive RWA', read: false, body: '{}' },
  { method: 'POST', path: '/airdrop/prepare-claim', note: 'Prepare airdrop claim', read: false, body: '{}' },
  { method: 'POST', path: '/airdrop/finalize-claim', note: 'Finalize airdrop claim', read: false, body: '{}' },
];

export function ApiConsolePanel() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<typeof ENDPOINT_CATALOG[0] | null>(ENDPOINT_CATALOG[0]);
  const [pathParams, setPathParams] = useState('');
  const [queryParams, setQueryParams] = useState('');
  const [requestBody, setRequestBody] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ endpoint: string; method: string; request: any; response: any; time: Date }>>([]);

  const finalPath = useMemo(() => {
    if (!selectedEndpoint) return '';
    let path = selectedEndpoint.path;
    if (path.includes('{') && pathParams) {
      path = path.replace(/\{[^}]+\}/g, pathParams);
    }
    if (queryParams) {
      path += (path.includes('?') ? '&' : '?') + queryParams;
    }
    return path;
  }, [selectedEndpoint, pathParams, queryParams]);

  const handleExecute = async () => {
    if (!selectedEndpoint) return;
    setLoading(true);
    try {
      let body = undefined;
      if (selectedEndpoint.method === 'POST' && requestBody) {
        try { body = JSON.parse(requestBody); } catch { body = requestBody; }
      }
      let res;
      if (selectedEndpoint.method === 'GET') {
        const url = `/api${finalPath}`;
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        res = r.ok ? await r.json() : { error: `HTTP ${r.status}`, text: await r.text() };
      } else {
        res = await postApi(finalPath, body || {});
      }
      setResponse(res);
      setHistory(prev => [{ endpoint: finalPath, method: selectedEndpoint.method, request: body, response: res, time: new Date() }, ...prev].slice(0, 50));
    } catch (e) {
      setResponse({ error: String(e) });
    }
    setLoading(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleClear = () => {
    setResponse(null);
  };

  const handleDownload = () => {
    if (!response) return;
    const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h2 className="font-display text-2xl font-medium text-fg">API Console</h2>
        <Badge variant="info">Live Proxy</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 panel">
          <h3 className="panel-title mb-4">Endpoints</h3>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {ENDPOINT_CATALOG.map(ep => (
              <button
                key={`${ep.method}-${ep.path}`}
                onClick={() => {
                  setSelectedEndpoint(ep);
                  setPathParams('');
                  setQueryParams('');
                  setRequestBody(ep.body || '');
                }}
                className={`w-full text-left p-2 rounded text-sm transition-colors ${
                  selectedEndpoint?.path === ep.path && selectedEndpoint?.method === ep.method
                    ? 'bg-accent/10 text-accent border-l-2 border-accent'
                    : 'text-muted hover:text-fg hover:bg-surface-2'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={ep.method === 'GET' ? 'ok' : 'warn'} className="text-xs">{ep.method}</Badge>
                  <code className="font-mono text-xs">{ep.path}</code>
                </div>
                <p className="text-xs text-muted mt-0.5">{ep.note}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selectedEndpoint && (
            <div className="panel">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4 min-w-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedEndpoint.method === 'GET' ? 'ok' : 'warn'}>{selectedEndpoint.method}</Badge>
                    <code className="font-mono text-sm">/api{finalPath}</code>
                  </div>
                  <p className="text-xs text-muted mt-1">{selectedEndpoint.note}</p>
                </div>
              </div>

              {selectedEndpoint.path.includes('{') && (
                <Input
                  label="Path Params (comma-separated for multiple)"
                  value={pathParams}
                  onChange={e => setPathParams(e.target.value)}
                  placeholder="e.g. block-id or addr1,addr2"
                />
              )}

              {selectedEndpoint.read && selectedEndpoint.params && (
                <Input
                  label="Query Params"
                  value={queryParams}
                  onChange={e => setQueryParams(e.target.value)}
                  placeholder={selectedEndpoint.params}
                />
              )}

              {!selectedEndpoint.read && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted">Request Body (JSON)</label>
                  <textarea
                    value={requestBody}
                    onChange={e => setRequestBody(e.target.value)}
                    className="input w-full h-32 font-mono text-xs resize-y"
                    placeholder={selectedEndpoint.body || '{}'}
                  />
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleExecute} loading={loading} variant="primary">
                  <Play size={16} /> Execute
                </Button>
                <Button onClick={handleClear} variant="secondary">
                  <Trash2 size={16} /> Clear
                </Button>
                {response && (
                  <>
                    <Button onClick={() => handleCopy(JSON.stringify(response, null, 2))} variant="ghost">
                      <Copy size={16} /> Copy
                    </Button>
                    <Button onClick={handleDownload} variant="ghost">
                      <Download size={16} /> Download
                    </Button>
                  </>
                )}
              </div>

              {response && (
                <div className="mt-4">
                  <h4 className="font-medium mb-2">Response</h4>
                  <div className="bg-surface-2 border border-border rounded-lg p-4 max-h-96 overflow-auto">
                    <pre className="text-xs text-fg font-mono">{JSON.stringify(response, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="panel">
            <h3 className="panel-title mb-4">Request History</h3>
            {history.length === 0 ? (
              <p className="text-muted text-center py-8">No requests yet</p>
            ) : (
              <Table
                headers={['Time', 'Method', 'Endpoint', 'Status']}
                rows={history.map(h => [
                  h.time.toLocaleTimeString(),
                  h.method,
                  h.endpoint,
                  h.response?.ok ? 'OK' : h.response?.error || 'Error',
                ])}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}