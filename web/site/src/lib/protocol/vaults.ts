import { api, apiPostJson } from "@/lib/api/client";

export type VaultLockType = "cltv" | "csv";

export type VaultCreateResult = {
  address: string;
  redeemScriptHex: string;
  beneficiaryPubkeyHex: string;
  lockType: VaultLockType;
  unlockAt: number;
  amountAtoms: number;
};

export type VaultStatus = {
  address: string;
  outpoint?: { tx: string; index: number };
  amountAtoms: number;
  lockType: VaultLockType;
  unlockAt: number;
  currentHeight: number;
  unlocked: boolean;
  blocksRemaining: number;
};

export type VaultClaimResult = {
  txIdHex: string;
};

export async function createVault(params: {
  beneficiaryPubkeyHex: string;
  amountAtoms: number;
  lockType: VaultLockType;
  unlockAt: number;
}): Promise<VaultCreateResult> {
  const beneficiary = params.beneficiaryPubkeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(beneficiary)) {
    throw new Error("Beneficiary pubkey must be 64-char hex");
  }
  if (params.amountAtoms <= 0) throw new Error("Amount must be positive");
  if (params.unlockAt < 1) throw new Error("Unlock height/blocks must be ≥ 1");

  const res = (await apiPostJson("/api/vault/create", {
    beneficiary_pubkey_hex: beneficiary,
    amount_atoms: params.amountAtoms,
    lock_type: params.lockType,
    unlock_at: params.unlockAt,
  })) as {
    address: string;
    redeem_script_hex: string;
    beneficiary_pubkey_hex: string;
    lock_type: VaultLockType;
    unlock_at: number;
    amount_atoms: number;
  };

  return {
    address: res.address,
    redeemScriptHex: res.redeem_script_hex,
    beneficiaryPubkeyHex: res.beneficiary_pubkey_hex,
    lockType: res.lock_type,
    unlockAt: res.unlock_at,
    amountAtoms: res.amount_atoms,
  };
}

export async function getVaultStatus(addressOrOutpoint: string): Promise<VaultStatus> {
  const q = addressOrOutpoint.includes(":")
    ? `outpoint=${encodeURIComponent(addressOrOutpoint.trim())}`
    : `address=${encodeURIComponent(addressOrOutpoint.trim())}`;
  return api<VaultStatus>(`/api/vault/status?${q}`);
}

export async function claimVault(params: {
  outpointTx: string;
  outpointIndex: number;
  destination: string;
  beneficiarySecretHex?: string;
}): Promise<VaultClaimResult> {
  const res = (await apiPostJson("/api/vault/claim", {
    outpoint: { tx: params.outpointTx.trim(), index: params.outpointIndex },
    destination: params.destination.trim(),
    beneficiary_secret_hex: params.beneficiarySecretHex?.trim().toLowerCase() || undefined,
  })) as { tx_id_hex: string };

  return { txIdHex: res.tx_id_hex };
}

export function parseOutpoint(raw: string): { tx: string; index: number } {
  const [tx, idx] = raw.trim().split(":");
  if (!tx || idx === undefined || Number.isNaN(Number(idx))) {
    throw new Error("Outpoint must be txid:index");
  }
  return { tx, index: Number(idx) };
}
