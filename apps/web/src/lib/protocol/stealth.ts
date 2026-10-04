import { api, apiPostJson } from "@/lib/api/client";
import type { ApiUtxos, ApiHistory } from "@/lib/api/contract";

export type StealthMetaAddress = {
  scanPubkeyHex: string;
  spendPubkeyHex: string;
  metaAddress: string;
  viewTag?: string;
};

export type StealthOnetime = {
  address: string;
  ephemeralPubkeyHex: string;
  viewTag: string;
  txHint?: string;
};

export type StealthScanHit = {
  outpoint: { tx: string; index: number };
  value: number;
  address: string;
  /** Present only after local ECDH with the scan private key — never from the server. */
  oneTimePrivkeyHex?: string;
};

export async function createStealthMeta(
  scanPubkeyHex: string,
  spendPubkeyHex: string,
  viewTag?: string,
): Promise<StealthMetaAddress> {
  const scan = scanPubkeyHex.trim().toLowerCase();
  const spend = spendPubkeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(scan) || !/^[0-9a-f]{64}$/.test(spend)) {
    throw new Error("Scan and spend pubkeys must be 64-char hex");
  }
  const res = (await apiPostJson("/api/stealth/create", {
    scan_pubkey_hex: scan,
    spend_pubkey_hex: spend,
    view_tag: viewTag?.trim() || undefined,
  })) as {
    meta_address: string;
    scan_pubkey_hex: string;
    spend_pubkey_hex: string;
    view_tag?: string;
  };
  return {
    scanPubkeyHex: res.scan_pubkey_hex,
    spendPubkeyHex: res.spend_pubkey_hex,
    metaAddress: res.meta_address,
    viewTag: res.view_tag,
  };
}

export async function deriveOnetimeAddress(
  metaAddress: string,
  amountAtoms?: number,
): Promise<StealthOnetime> {
  const res = (await apiPostJson("/api/stealth/derive", {
    meta_address: metaAddress.trim(),
    amount_atoms: amountAtoms,
  })) as {
    address: string;
    ephemeral_pubkey_hex: string;
    view_tag: string;
  };
  return {
    address: res.address,
    ephemeralPubkeyHex: res.ephemeral_pubkey_hex,
    viewTag: res.view_tag,
  };
}

/**
 * Stealth scan must not send scan_privkey to any remote.
 * Private keys stay in the browser; use a local node or offline ECDH tool.
 * Optional view_tag-only probe hits a public filter endpoint (no secrets).
 */
export async function scanStealthOutputs(
  _scanPrivkeyHex: string,
  viewTag?: string,
): Promise<StealthScanHit[]> {
  void _scanPrivkeyHex;
  // Never POST scan_privkey_hex — that would let the explorer identify all payments.
  if (viewTag?.trim()) {
    try {
      const res = (await apiPostJson("/api/stealth/probe", {
        view_tag: viewTag.trim().toLowerCase(),
      })) as { candidates?: StealthScanHit[] };
      return res.candidates ?? [];
    } catch {
      // probe may not exist yet
    }
  }
  throw new Error(
    "Stealth scan is client-side only — the scan private key never leaves this browser. " +
      "Run a local node or offline ECDH against published ephemerals; do not paste the key into a public API.",
  );
}

export async function prepareStealthSpend(
  fromAddress: string,
  toAddress: string,
  amountAtoms: number,
): Promise<{ sighash: string }> {
  return api<{ sighash: string }>(
    `/api/prepare?from=${encodeURIComponent(fromAddress)}&to=${encodeURIComponent(toAddress)}&amount=${amountAtoms}`,
    "POST",
  );
}

export async function submitStealthSpend(
  fromAddress: string,
  toAddress: string,
  amountAtoms: number,
  sigHex: string,
): Promise<{ tx: string }> {
  return api<{ tx: string }>(
    `/api/submit?from=${encodeURIComponent(fromAddress)}&to=${encodeURIComponent(toAddress)}&amount=${amountAtoms}&sig=${encodeURIComponent(sigHex)}`,
    "POST",
  );
}

export async function fetchStealthUtxos(address: string): Promise<ApiUtxos> {
  return api<ApiUtxos>(`/api/utxos?address=${encodeURIComponent(address)}`);
}

export async function fetchStealthHistory(address: string): Promise<ApiHistory> {
  return api<ApiHistory>(`/api/history?address=${encodeURIComponent(address)}`);
}
