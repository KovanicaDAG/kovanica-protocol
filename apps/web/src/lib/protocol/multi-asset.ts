import { api, apiPostJson } from "@/lib/api/client";

/** Native asset id — frozen string per KVP-102 / RFC-002. */
export const NATIVE_ASSET_ID = "KVNC" as const;

/** Legacy wire form still used by some wallet paths / older nodes. */
const ZERO_HASH = "0".repeat(64);

export type AssetId = string;

export type AssetBalance = {
  assetId: AssetId;
  /** Amount in atoms (smallest unit). */
  amountAtoms: number;
};

export type UtxoWithAsset = {
  tx: string;
  index: number;
  value: number;
  assetId: AssetId;
};

export type AddressBalances = {
  address: string;
  /** Deprecated scalar — always KVNC for backward compat. */
  balance: number;
  /** Per-asset map (preferred). Keys are asset_id strings. */
  balances: Record<AssetId, number>;
  utxos: UtxoWithAsset[];
};

export type HistoryEntry = {
  block?: string;
  tx: string;
  kind?: string;
  delta: number;
  assetId: AssetId;
};

export type AddressHistory = {
  address: string;
  balance: number;
  balances: Record<AssetId, number>;
  txs: HistoryEntry[];
};

export type PrepareRequest = {
  from: string;
  to: string;
  amount: number;
  /** Defaults to KVNC when omitted (API contract). */
  assetId?: AssetId;
};

export type PrepareResult = {
  sighash: string;
  fee: number;
  feeAssetId: AssetId;
  inputs: UtxoWithAsset[];
  outputs: Array<{ address: string; value: number; assetId: AssetId }>;
  change?: { value: number; assetId: AssetId };
};

/**
 * Normalise asset_id from API (snake_case or camelCase) → canonical string.
 * Native is always "KVNC". Accepts null/empty/"KVNC"/64-zero hash.
 */
export function normalizeAssetId(raw: unknown): AssetId {
  if (raw == null) return NATIVE_ASSET_ID;
  if (typeof raw !== "string" || !raw.trim()) return NATIVE_ASSET_ID;
  const s = raw.trim();
  if (s.toUpperCase() === "KVNC") return NATIVE_ASSET_ID;
  if (s === ZERO_HASH) return NATIVE_ASSET_ID;
  return s.toLowerCase();
}

/** Short display label for badges (full id for native, truncated hex for others). */
export function shortAssetLabel(assetId: AssetId, maxHex = 8): string {
  if (assetId === NATIVE_ASSET_ID || assetId.toUpperCase() === "KVNC") {
    return "KVNC";
  }
  const id = assetId.toLowerCase();
  if (id.length <= maxHex + 2) return id;
  return `${id.slice(0, maxHex)}…`;
}

type BalancesRaw =
  | Record<string, number>
  | Array<{ asset_id?: string | null; assetId?: string | null; balance?: number; amount?: number }>;

/**
 * Prefer balances field; fall back to scalar balance as KVNC only.
 * Accepts both wire shapes:
 *   - map:  { "KVNC": n, "<hex>": n }          (KVP-102 gap plan / node)
 *   - list: [{ asset_id, balance }, ...]       (networkConstants ApiUtxos)
 */
export function balancesFromResponse(raw: {
  balance?: number;
  balances?: BalancesRaw;
}): Record<AssetId, number> {
  const out: Record<AssetId, number> = {};

  if (raw.balances && typeof raw.balances === "object") {
    if (Array.isArray(raw.balances)) {
      for (const row of raw.balances) {
        if (!row || typeof row !== "object") continue;
        const id = normalizeAssetId(row.asset_id ?? row.assetId);
        const n = Number(row.balance ?? row.amount ?? NaN);
        if (Number.isFinite(n)) out[id] = (out[id] ?? 0) + n;
      }
    } else {
      for (const [k, v] of Object.entries(raw.balances)) {
        const id = normalizeAssetId(k);
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n)) out[id] = n;
      }
    }
  }

  if (Object.keys(out).length === 0 && typeof raw.balance === "number") {
    out[NATIVE_ASSET_ID] = raw.balance;
  }
  return out;
}

/**
 * GET /api/utxos?address=<addr>
 * Expects asset_id on each UTXO and balances (map or list) once node HTTP is live.
 */
export async function fetchAddressBalances(address: string): Promise<AddressBalances> {
  const addr = address.trim();
  if (!addr) throw new Error("Address required");

  const res = (await api(`/api/utxos?address=${encodeURIComponent(addr)}`)) as {
    address?: string;
    balance?: number;
    balances?: BalancesRaw;
    utxos?: Array<{
      tx?: string;
      index?: number;
      value?: number;
      asset_id?: string | null;
      assetId?: string | null;
    }>;
  };

  const balances = balancesFromResponse(res);
  const utxos: UtxoWithAsset[] = (res.utxos ?? []).map((u) => ({
    tx: String(u.tx ?? ""),
    index: Number(u.index ?? 0),
    value: Number(u.value ?? 0),
    assetId: normalizeAssetId(u.asset_id ?? u.assetId),
  }));

  // If balances map empty but we have UTXOs, aggregate from UTXOs.
  if (Object.keys(balances).length === 0 && utxos.length > 0) {
    for (const u of utxos) {
      balances[u.assetId] = (balances[u.assetId] ?? 0) + u.value;
    }
  }

  return {
    address: res.address ?? addr,
    balance: typeof res.balance === "number" ? res.balance : balances[NATIVE_ASSET_ID] ?? 0,
    balances,
    utxos,
  };
}

/**
 * GET /api/history?address=<addr>
 */
export async function fetchAddressHistory(address: string): Promise<AddressHistory> {
  const addr = address.trim();
  if (!addr) throw new Error("Address required");

  const res = (await api(`/api/history?address=${encodeURIComponent(addr)}`)) as {
    address?: string;
    balance?: number;
    balances?: BalancesRaw;
    txs?: Array<{
      block?: string;
      tx?: string;
      kind?: string;
      delta?: number;
      asset_id?: string | null;
      assetId?: string | null;
    }>;
  };

  const balances = balancesFromResponse(res);
  const txs: HistoryEntry[] = (res.txs ?? []).map((t) => ({
    block: t.block,
    tx: String(t.tx ?? ""),
    kind: t.kind,
    delta: Number(t.delta ?? 0),
    assetId: normalizeAssetId(t.asset_id ?? t.assetId),
  }));

  return {
    address: res.address ?? addr,
    balance: typeof res.balance === "number" ? res.balance : balances[NATIVE_ASSET_ID] ?? 0,
    balances,
    txs,
  };
}

/**
 * POST /api/prepare — asset-scoped coin selection.
 * Fees always paid in KVNC.
 * Wire: send "KVNC" for native (KVP-102). Older nodes that only accept omit/null
 * still treat unknown asset_id as native when only KVNC UTXOs exist.
 */
export async function prepareTransfer(params: PrepareRequest): Promise<PrepareResult> {
  const from = params.from.trim();
  const to = params.to.trim();
  if (!from || !to) throw new Error("from and to required");
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("amount must be a positive number of atoms");
  }

  const assetId = params.assetId ? normalizeAssetId(params.assetId) : NATIVE_ASSET_ID;

  const body: Record<string, unknown> = {
    from,
    to,
    amount: params.amount,
    asset_id: assetId,
  };

  const res = (await apiPostJson("/api/prepare", body)) as {
    sighash?: string;
    fee?: number;
    fee_asset_id?: string | null;
    feeAssetId?: string | null;
    inputs?: Array<{
      tx?: string;
      index?: number;
      value?: number;
      asset_id?: string | null;
      assetId?: string | null;
    }>;
    outputs?: Array<{
      address?: string;
      value?: number;
      asset_id?: string | null;
      assetId?: string | null;
    }>;
    change?: { value?: number; asset_id?: string | null; assetId?: string | null };
    // Legacy prepare shape (wallet path): single outpoint + change scalar
    value?: number;
    outpoint?: { tx?: string; index?: number };
  };

  // Prefer full multi-asset response; fall back to legacy single-input shape.
  const inputs: UtxoWithAsset[] =
    res.inputs && res.inputs.length > 0
      ? res.inputs.map((i) => ({
          tx: String(i.tx ?? ""),
          index: Number(i.index ?? 0),
          value: Number(i.value ?? 0),
          assetId: normalizeAssetId(i.asset_id ?? i.assetId),
        }))
      : res.outpoint
        ? [
            {
              tx: String(res.outpoint.tx ?? ""),
              index: Number(res.outpoint.index ?? 0),
              value: Number(res.value ?? params.amount),
              assetId,
            },
          ]
        : [];

  const outputs =
    res.outputs && res.outputs.length > 0
      ? res.outputs.map((o) => ({
          address: String(o.address ?? ""),
          value: Number(o.value ?? 0),
          assetId: normalizeAssetId(o.asset_id ?? o.assetId),
        }))
      : [{ address: to, value: params.amount, assetId }];

  const change =
    res.change && typeof res.change === "object" && "value" in res.change
      ? {
          value: Number(res.change.value ?? 0),
          assetId: normalizeAssetId(res.change.asset_id ?? res.change.assetId),
        }
      : typeof (res as { change?: unknown }).change === "number" &&
          Number((res as { change: number }).change) > 0
        ? {
            value: Number((res as { change: number }).change),
            assetId,
          }
        : undefined;

  return {
    sighash: String(res.sighash ?? ""),
    fee: Number(res.fee ?? 0),
    feeAssetId: normalizeAssetId(res.fee_asset_id ?? res.feeAssetId ?? NATIVE_ASSET_ID),
    inputs,
    outputs,
    change,
  };
}

/**
 * Build sorted list of assets for AssetPicker (native first, then others by id).
 */
export function assetPickerOptions(balances: Record<AssetId, number>): AssetBalance[] {
  const entries = Object.entries(balances).map(([assetId, amountAtoms]) => ({
    assetId: normalizeAssetId(assetId),
    amountAtoms,
  }));
  entries.sort((a, b) => {
    if (a.assetId === NATIVE_ASSET_ID) return -1;
    if (b.assetId === NATIVE_ASSET_ID) return 1;
    return a.assetId.localeCompare(b.assetId);
  });
  return entries;
}
