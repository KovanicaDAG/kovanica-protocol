import { useMemo, useState } from 'react';
import { Input, Button, Badge, Table } from './ui';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { Coins, Info, RefreshCw, ArrowRightLeft, Flame } from 'lucide-react';
import { useDexTokens } from '../hooks/useApi';
import { useKeyVault } from '../hooks/useKeyVault';

const NATIVE = 'KVNC';

/**
 * RFC-002 asset tooling, scoped honestly.
 *
 * The protocol has no asset-creation endpoint, and that is deliberate rather
 * than missing: RFC-002 §5 makes minting coinbase-only, and `apply_regular`
 * rejects any regular tx that produces an asset output it did not consume
 * (`LedgerError::AssetNotConserved`). So a browser cannot mint an asset, and
 * this panel does not pretend otherwise.
 *
 * It also does not pretend the asset id is a protocol-derived hash. `AssetId` is
 * a bare `[u8; 32]` (`crates/kovanica-state/src/tx.rs`); no code derives it
 * from a definition. Issuers pick the 32 bytes. The suggestion below is a
 * convenience over a chosen symbol, clearly labelled as operator-chosen.
 */
export function AssetsPanel() {
  const kv = useKeyVault();
  const { data: dexTokens } = useDexTokens();

  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [decimals, setDecimals] = useState('8');
  const [assetId, setAssetId] = useState('');

  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [burnAll, setBurnAll] = useState(false);

  // Operator-chosen identifier. NOT a protocol rule — see the file header.
  const suggestion = useMemo(() => {
    const s = symbol.trim();
    if (!s) return null;
    const domain = utf8ToBytes('kovanica-dashboard/asset-id');
    const body = utf8ToBytes(s.toLowerCase());
    return bytesToHex(sha256(concat(domain, body)));
  }, [symbol]);

  const idValid = /^[0-9a-fA-F]{64}$/.test(assetId.trim());

  const chainTokens = useMemo(() => {
    const list = dexTokens ?? [];
    return list.map((t) => ({
      id: t.asset_id,
      symbol: t.symbol || '—',
      name: t.name || '—',
    }));
  }, [dexTokens]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-medium text-fg">Multi-Asset</h2>
          <Badge variant="info">KVP-102</Badge>
        </div>
        <Badge variant="warn">Minting is coinbase-only</Badge>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-gold/40 bg-gold/5 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-gold" />
        <div className="space-y-2 text-sm text-muted">
          <p className="text-fg">This dashboard cannot create an asset, and that is by design.</p>
          <p>
            RFC-002 §5 restricts minting to coinbase transactions, and the ledger rejects any
            regular transaction that produces an asset output it did not consume. An asset first
            exists when it is minted in a coinbase by a block producer.
          </p>
          <p>
            What you can do here is prepare an asset identifier and its metadata, then transfer or
            burn assets that already exist.
          </p>
        </div>
      </div>

      <section className="panel space-y-4">
        <div className="flex items-center gap-2">
          <Coins size={18} className="text-blue" />
          <h3 className="font-display text-lg font-medium text-fg">Asset identifier</h3>
        </div>
        <p className="text-sm text-muted">
          An asset id is a 32-byte value chosen by the issuer. The protocol does not derive it from
          a definition, so any 32 bytes are valid — the ledger only requires that the value is
          consistent between a spend and its outputs.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Symbol" placeholder="MYTKN" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          <Input label="Name" placeholder="My Token" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {suggestion && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Suggested from symbol (your choice, not a protocol hash):</span>
            <code className="break-all font-mono text-fg">{suggestion}</code>
            <Button size="sm" variant="secondary" onClick={() => setAssetId(suggestion)}>
              Use
            </Button>
          </div>
        )}
        <Input
          label="Asset id (64 hex characters)"
          placeholder={suggestion ?? '32-byte hex identifier'}
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          className={assetId && !idValid ? 'border-destructive' : ''}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Decimals (display only)" value={decimals} onChange={(e) => setDecimals(e.target.value)} />
          <div className="flex items-end">
            <p className="text-xs text-muted">
              Metadata is a local note. The ledger stores the id and the amount, not this record.
            </p>
          </div>
        </div>
      </section>

      <section className="panel space-y-4">
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={18} className="text-ok" />
          <h3 className="font-display text-lg font-medium text-fg">Transfer or burn</h3>
        </div>
        {!kv.unlocked ? (
          <p className="text-sm text-muted">
            Unlock a wallet to sign a transfer. Keys never leave this tab.
          </p>
        ) : (
          <div className="space-y-3">
            <Input
              label="Recipient address"
              placeholder="kvnc…dag"
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
            />
            <Input
              label="Amount (atoms)"
              placeholder="1000000"
              value={burnAll ? 'all' : amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={burnAll}
            />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={burnAll} onChange={(e) => setBurnAll(e.target.checked)} />
              <Flame size={14} className="text-danger" />
              Burn instead of transfer
            </label>
            <Button variant="primary" disabled>
              {burnAll ? 'Burn transaction' : 'Transfer transaction'} — signing flow not wired yet
            </Button>
            <p className="text-xs text-muted">
              The browser can build and sign a plain native transfer, but multi-asset spends also
              need the asset-carrying sighash from the node. That endpoint has not been verified as
              usable, so this action stays disabled rather than failing at submit time.
            </p>
          </div>
        )}
      </section>

      <section className="panel space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <RefreshCw size={18} className="text-blue" />
            <h3 className="font-display text-lg font-medium text-fg">Assets on this network</h3>
          </div>
          <Badge variant={chainTokens.length ? 'ok' : 'info'}>
            {chainTokens.length ? `${chainTokens.length} listed` : 'none listed'}
          </Badge>
        </div>
        {chainTokens.length === 0 ? (
          <p className="text-sm text-muted">
            No assets are currently listed on <code className="font-mono">{NATIVE}</code>'s DEX index.
            The first asset appears when a block producer mints one in a coinbase.
          </p>
        ) : (
          <Table
            headers={['Asset id', 'Symbol', 'Name']}
            rows={chainTokens.map((t) => [t.id.slice(0, 20) + '…', t.symbol, t.name])}
          />
        )}
      </section>
    </div>
  );
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
