import { useState } from 'react';
import { Button, Input, Badge, Table } from './ui';
import { Wallet, Lock, Unlock, Copy, Check, Eye, EyeOff, KeyRound, Trash2, ShieldCheck } from 'lucide-react';
import { useKeyVault } from '../hooks/useKeyVault';
import { useUtxos, useHistory, fmtKvnc, fmtNumber } from '../hooks/useApi';
import type { KeyVault } from '../lib/kvnc';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { signingKey } from '../lib/kvnc';

type Mode = 'locked' | 'create' | 'import';

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ml-2 align-middle text-muted hover:text-fg"
      title="Copy"
      aria-label="Copy to clipboard"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
    </button>
  );
}

/** Collapsible row of a code-like value (address, pubkey, seed). */
function SecretRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!secret);
  const shown = revealed ? value : '•'.repeat(Math.min(value.length, 24));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex items-center gap-1 min-w-0">
        <code className="font-mono text-xs text-fg break-all">{shown}</code>
        {value && <CopyButton value={value} />}
        {secret && (
          <button
            type="button"
            className="text-muted hover:text-fg"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Hide' : 'Reveal'}
            title={revealed ? 'Hide' : 'Reveal'}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </span>
    </div>
  );
}

export function WalletPanel() {
  const kv = useKeyVault();
  const [mode, setMode] = useState<Mode>('locked');
  const [phrase, setPhrase] = useState('');
  const [rawSeed, setRawSeed] = useState('');
  const [index, setIndex] = useState('0');
  const [passphrase, setPassphrase] = useState('');
  const [passphrase2, setPassphrase2] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const vault = kv.vault;
  const addr = vault?.address ?? '';
  const { data: utxos, isLoading: utxosLoading } = useUtxos(addr, 10000);
  const { data: history, isLoading: historyLoading } = useHistory(addr, 10000);

  const idx = Number.isFinite(Number(index)) && Number(index) >= 0 ? Number(index) : 0;
  const pubHex = vault ? bytesToHex(vault.publicKey) : '';
  const signPub = vault ? bytesToHex(ed25519.getPublicKey(signingKey(vault, idx))) : '';

  function reset() {
    setPhrase('');
    setRawSeed('');
    setPassphrase('');
    setPassphrase2('');
    setRemember(false);
    kv.clearError();
  }

  function doRememberCheck(pass: string) {
    if (!remember) return;
    if (pass.length < 10) {
      setNotice('Passphrase must be at least 10 characters, or turn off "remember this device".');
      return;
    }
    if (pass !== passphrase2) {
      setNotice('Passphrases do not match.');
      return;
    }
    setBusy(true);
    kv.remember(pass, idx)
      .then(() => setNotice('Encrypted backup stored on this device.'))
      .catch((e) => setNotice(e?.message ?? String(e)))
      .finally(() => setBusy(false));
  }

  function handleCreate() {
    try {
      const p = kv.newSeedPhrase(128);
      setPhrase(p);
      kv.importPhrase(p, idx);
      setNotice('New wallet created. Write the recovery phrase down before doing anything else.');
      doRememberCheck(passphrase);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  function handleImport() {
    try {
      const src = mode === 'import' && rawSeed.trim() ? null : phrase;
      if (src === null) kv.importRawSeed(rawSeed.trim());
      else kv.importPhrase(src, idx);
      setNotice('Wallet unlocked in this tab only.');
      doRememberCheck(passphrase);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  function handleUnlockStored() {
    setBusy(true);
    kv.unlock(passphrase, idx)
      .then(() => setNotice('Vault unlocked for this tab.'))
      .catch((e) => setNotice(e?.message ?? String(e)))
      .finally(() => setBusy(false));
  }

  // ---- Locked view -------------------------------------------------------
  if (!kv.unlocked) {
    return (
      <div className="panel space-y-5">
        <div>
          <h2 className="text-lg font-medium text-fg flex items-center gap-2">
            <Wallet size={20} className="text-gold" /> Wallet
          </h2>
          <p className="text-sm text-muted mt-1">
            Keys are generated and used in this browser tab. They are never sent to the dashboard server or a node.
          </p>
        </div>

        {notice && <div className="text-sm text-gold">{notice}</div>}
        {kv.error && <div className="text-sm text-danger">{kv.error}</div>}

        <div className="flex flex-wrap gap-2">
          <Button variant={mode === 'create' ? 'primary' : 'secondary'} onClick={() => { setMode('create'); reset(); }}>
            Create new
          </Button>
          <Button variant={mode === 'import' ? 'primary' : 'secondary'} onClick={() => { setMode('import'); reset(); }}>
            Import existing
          </Button>
        </div>

        {mode === 'create' && (
          <div className="space-y-3">
            <Button onClick={handleCreate}><KeyRound size={16} /> Generate recovery phrase</Button>
            {phrase && (
              <>
                <div className="bg-surface-2 border border-gold/40 rounded p-3 space-y-2">
                  <p className="text-xs text-gold">Recovery phrase — the only way to restore this wallet.</p>
                  <code className="font-mono text-sm text-fg break-words">{phrase}</code>
                  <CopyButton value={phrase} />
                </div>
                <p className="text-xs text-muted">A vault is open in this tab. Nothing has been written to disk.</p>
              </>
            )}
          </div>
        )}

        {mode === 'import' && (
          <div className="space-y-3">
            <Input
              label="Recovery phrase (12 or 24 words)"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="word1 word2 ..."
              autoComplete="off"
            />
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Use a raw 32-byte seed instead</summary>
              <div className="mt-2">
                <Input
                  label="Raw seed (64 hex chars)"
                  value={rawSeed}
                  onChange={(e) => setRawSeed(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </details>
            <Button onClick={handleImport}><Unlock size={16} /> Unlock in this tab</Button>
          </div>
        )}

        {kv.hasStored && (
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-sm text-fg flex items-center gap-2"><Lock size={16} className="text-gold" /> Encrypted wallet on this device</p>
            <Input
              label="Passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleUnlockStored} loading={busy}><Unlock size={16} /> Unlock</Button>
              <Button variant="destructive" onClick={() => { kv.forget(idx); setNotice('Stored vault removed from this device.'); }}>
                <Trash2 size={16} /> Forget
              </Button>
            </div>
          </div>
        )}

        {mode === 'create' || mode === 'import' ? (
          <PassphraseFields
            passphrase={passphrase}
            setPassphrase={setPassphrase}
            passphrase2={passphrase2}
            setPassphrase2={setPassphrase2}
            remember={remember}
            setRemember={setRemember}
          />
        ) : null}
      </div>
    );
  }

  // ---- Unlocked view -----------------------------------------------------
  return (
    <div className="panel space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-fg flex items-center gap-2">
          <Wallet size={20} className="text-gold" /> Wallet
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => kv.lock()}><Lock size={16} /> Lock</Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-ok">
        <ShieldCheck size={14} /> Key held in this tab only — it disappears when the tab closes.
      </div>

      {notice && <div className="text-sm text-gold">{notice}</div>}

      <div className="bg-surface-2 border border-border rounded p-3 divide-y divide-border">
        <SecretRow label="Address" value={addr} />
        <SecretRow label="Public key" value={pubHex} />
        <SecretRow label={`Signing key (index ${idx})`} value={signPub} />
      </div>

      <BalanceAndActivity
        utxos={utxos}
        utxosLoading={utxosLoading}
        history={history}
        historyLoading={historyLoading}
        onIndexChange={setIndex}
        index={index}
      />
    </div>
  );
}

function PassphraseFields(props: {
  passphrase: string; setPassphrase: (v: string) => void;
  passphrase2: string; setPassphrase2: (v: string) => void;
  remember: boolean; setRemember: (v: boolean) => void;
}) {
  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-sm text-fg">Remember on this device (optional)</summary>
      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={props.remember} onChange={(e) => props.setRemember(e.target.checked)} />
          Encrypt the seed with a passphrase and store it locally
        </label>
        {props.remember && (
          <>
            <Input
              label="Passphrase (min 10 chars)"
              type="password"
              value={props.passphrase}
              onChange={(e) => props.setPassphrase(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              label="Confirm passphrase"
              type="password"
              value={props.passphrase2}
              onChange={(e) => props.setPassphrase2(e.target.value)}
              autoComplete="new-password"
            />
          </>
        )}
        <p className="text-xs text-muted">Off by default. When on, the seed is stored AES-GCM encrypted, keyed by a PBKDF2 hash of this passphrase.</p>
      </div>
    </details>
  );
}

function BalanceAndActivity(props: {
  utxos: ReturnType<typeof useUtxos>['data'];
  utxosLoading: boolean;
  history: ReturnType<typeof useHistory>['data'];
  historyLoading: boolean;
  index: string; onIndexChange: (v: string) => void;
}) {
  const { utxos, utxosLoading, history, historyLoading, index, onIndexChange } = props;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="ok">Native balance {fmtKvnc(utxos?.balance ?? 0)} KVNC</Badge>
        <span className="text-xs text-muted">{fmtNumber(utxos?.total ?? 0)} UTXOs</span>
        <div className="ml-auto w-24">
          <Input
            label="Address index"
            value={index}
            onChange={(e) => onIndexChange(e.target.value)}
          />
        </div>
      </div>

      {utxos && Object.keys(utxos.balances ?? {}).length > 1 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(utxos.balances ?? {}).map(([asset, atoms]) => (
            <Badge key={asset} variant="info">{asset}: {fmtKvnc(atoms)}</Badge>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-fg mb-2">Recent history</h3>
        {historyLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !history || history.txs.length === 0 ? (
          <p className="text-sm text-muted">No history for this address yet.</p>
        ) : (
          <Table
            headers={['Block', 'Type', 'Asset', 'Delta']}
            rows={history.txs.slice(0, 25).map((t) => [
              String(t.block).slice(0, 12),
              t.kind,
              t.asset_id ?? 'KVNC',
              `${t.delta >= 0 ? '+' : ''}${fmtKvnc(t.delta)}`,
            ])}
          />
        )}
      </div>
    </div>
  );
}
