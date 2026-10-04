import { isNativeAsset, type ApiUtxo } from "./contract";

/**
 * Build prepare / submit query strings with optional RFC-002 asset_id.
 * Public node may ignore asset_id until the explorer API is upgraded;
 * local/preview nodes should honour it once multi-asset UTXOs exist.
 */
export function prepareUrl(
  from: string,
  to: string,
  amount: number,
  assetId?: string | null,
): string {
  const base = `/api/prepare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${amount}`;
  if (!isNativeAsset(assetId)) {
    return `${base}&asset_id=${encodeURIComponent(assetId!)}`;
  }
  return base;
}

export function submitUrl(
  from: string,
  to: string,
  amount: number,
  sig: string,
  assetId?: string | null,
): string {
  const base = `/api/submit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${amount}&sig=${encodeURIComponent(sig)}`;
  if (!isNativeAsset(assetId)) {
    return `${base}&asset_id=${encodeURIComponent(assetId!)}`;
  }
  return base;
}

/** Group UTXOs by asset for the AssetPicker. */
export function assetOptionsFromUtxos(utxos: ApiUtxo[]): {
  assetId: string | null;
  balance: number;
}[] {
  const map = new Map<string, number>();
  for (const u of utxos) {
    const key = isNativeAsset(u.asset_id) ? "" : (u.asset_id as string);
    map.set(key, (map.get(key) ?? 0) + u.value);
  }
  const out: { assetId: string | null; balance: number }[] = [];
  // Native first
  if (map.has("")) {
    out.push({ assetId: null, balance: map.get("")! });
    map.delete("");
  } else {
    out.push({ assetId: null, balance: 0 });
  }
  for (const [id, balance] of map) {
    out.push({ assetId: id, balance });
  }
  return out;
}

export function balanceForAsset(
  utxos: ApiUtxo[],
  assetId: string | null | undefined,
): number {
  return utxos
    .filter((u) =>
      isNativeAsset(assetId)
        ? isNativeAsset(u.asset_id)
        : u.asset_id === assetId,
    )
    .reduce((n, u) => n + u.value, 0);
}
