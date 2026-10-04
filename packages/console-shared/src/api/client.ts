import type { Head, Block, Utxo, Transaction, PrepareResponse, SubmitResponse, BalanceResponse, HistoryEntry } from '../types';

const DEFAULT_API = 'https://explorer.kovanica.online';

export class KovanicaApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_API) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
  }

  // ── Chain queries ────────────────────────────────────────────────

  head(): Promise<Head> {
    return this.get('/api/head');
  }

  bootstrap(): Promise<Record<string, unknown>> {
    return this.get('/api/bootstrap');
  }

  state(): Promise<Record<string, unknown>> {
    return this.get('/api/state');
  }

  blocks(): Promise<Block[]> {
    return this.get('/api/blocks');
  }

  block(id: string): Promise<Block> {
    return this.get(`/api/blocks/${id}`);
  }

  // ── UTXO & balances ─────────────────────────────────────────────

  utxos(address: string): Promise<Utxo[]> {
    return this.get(`/api/utxos/${address}`);
  }

  balance(address: string): Promise<BalanceResponse> {
    return this.get(`/api/balance/${address}`);
  }

  // ── Transactions ────────────────────────────────────────────────

  transaction(id: string): Promise<Transaction> {
    return this.get(`/api/tx/${id}`);
  }

  history(address: string, maxBlocks: number = 100): Promise<HistoryEntry[]> {
    return this.get(`/api/history/${address}?max=${maxBlocks}`);
  }

  // ── Prepare / Submit ────────────────────────────────────────────

  prepare(from: string, to: string, amount: string): Promise<PrepareResponse> {
    return this.post('/api/prepare', { from, to, amount });
  }

  submit(from: string, to: string, amount: string, signature: string): Promise<SubmitResponse> {
    return this.post('/api/submit', { from, to, amount, signature });
  }

  // ── Assets ──────────────────────────────────────────────────────

  assetInfo(assetId: string): Promise<Record<string, unknown>> {
    return this.get(`/api/asset/${assetId}`);
  }

  nftDetail(assetId: string): Promise<Record<string, unknown>> {
    return this.get(`/api/nft/${assetId}`);
  }

  collectionDetail(collectionId: string): Promise<Record<string, unknown>> {
    return this.get(`/api/collection/${collectionId}`);
  }

  // ── HTLC ────────────────────────────────────────────────────────

  htlcBalance(script: string): Promise<{ balance: string }> {
    return this.get(`/api/htlc/balance/${script}`);
  }

  prepareCreateHtlc(
    from: string,
    amount: string,
    recipientPk: string,
    preimageHash: string,
    timeout: number,
    assetId: string | null
  ): Promise<PrepareResponse> {
    return this.post('/api/prepare/htlc/create', {
      from, amount, recipient_pk: recipientPk, preimage_hash: preimageHash, timeout, asset_id: assetId,
    });
  }

  prepareRedeemHtlc(
    from: string,
    outpoint: { tx_id: string; index: number },
    script: string,
    preimage: string,
    to: string
  ): Promise<PrepareResponse> {
    return this.post('/api/prepare/htlc/redeem', {
      from, outpoint, script, preimage, to,
    });
  }

  prepareRefundHtlc(
    from: string,
    outpoint: { tx_id: string; index: number },
    script: string,
    to: string
  ): Promise<PrepareResponse> {
    return this.post('/api/prepare/htlc/refund', {
      from, outpoint, script, to,
    });
  }

  // ── Multisig ────────────────────────────────────────────────────

  createMultisigAddress(threshold: number, pubkeys: string[]): Promise<{ address: string; redeem_script: string }> {
    return this.post('/api/multisig/create', { threshold, pubkeys });
  }

  // ── P2P ─────────────────────────────────────────────────────────

  p2p(): Promise<Record<string, unknown>> {
    return this.get('/api/p2p');
  }
}

export const defaultClient = new KovanicaApiClient();