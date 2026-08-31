import { bytesToHex } from "@noble/hashes/utils.js";
import { apiPostJson } from "@/lib/api/client";
import { seedFromMnemonic } from "./keys";

export type MultisigOutput = {
  to: string;
  atoms: number;
};

export type MultisigAddressResult = {
  address: string;
  redeemScriptHex: string;
  threshold: number;
  pubkeys: string[];
};

export type MultisigSpendProposal = {
  sighashHex: string;
  txBlobHex: string;
  from: string;
  outputs: MultisigOutput[];
};

function cleanPubkeys(pubkeys: string[]): string[] {
  return pubkeys
    .map((p) => p.trim().toLowerCase())
    .filter((p) => /^[0-9a-f]{64}$/.test(p));
}

function validateMofN(threshold: number, pubkeys: string[]): void {
  if (threshold < 1 || threshold > pubkeys.length || pubkeys.length > 16) {
    throw new Error("Invalid M-of-N: need 1 <= M <= N <= 16");
  }
}

/**
 * Build a P2SH-style multisig address from a threshold and cosigner pubkeys.
 * Calls the configured node's `POST /api/multisig/create` endpoint.
 */
export async function createMultisigAddress(
  threshold: number,
  pubkeys: string[],
): Promise<MultisigAddressResult> {
  const clean = cleanPubkeys(pubkeys);
  validateMofN(threshold, clean);
  const res = (await apiPostJson("/api/multisig/create", {
    threshold,
    pubkeys_hex: clean,
  })) as { address: string; redeem_script_hex: string };
  return {
    address: res.address,
    redeemScriptHex: res.redeem_script_hex,
    threshold,
    pubkeys: clean,
  };
}

/**
 * Initiate a spend from a multisig address. Returns a transaction blob and
 * sighash for cosigners via `POST /api/multisig/build`.
 */
export async function buildMultisigSpend(
  from: string,
  outputs: MultisigOutput[],
): Promise<MultisigSpendProposal> {
  if (outputs.length === 0 || outputs.some((o) => !o.to || o.atoms <= 0)) {
    throw new Error("Need at least one valid output");
  }
  const res = (await apiPostJson("/api/multisig/build", {
    address: from,
    outputs: outputs.map((o) => ({
      address: o.to,
      amount_atoms: o.atoms,
    })),
  })) as { tx_blob_hex: string; sighash_hex: string };
  return {
    sighashHex: res.sighash_hex,
    txBlobHex: res.tx_blob_hex,
    from,
    outputs,
  };
}

/**
 * Create one partial Ed25519 signature for a multisig transaction blob using
 * a mnemonic-derived secret. Calls `POST /api/multisig/sign`.
 */
export async function signMultisigPartial(
  mnemonic: string,
  index: number,
  txBlobHex: string,
): Promise<string> {
  const secretHex = bytesToHex(seedFromMnemonic(mnemonic, index));
  const res = (await apiPostJson("/api/multisig/sign", {
    tx_blob_hex: txBlobHex,
    secret_hex: secretHex,
  })) as { partial_sig_hex: string };
  return res.partial_sig_hex;
}

/**
 * Combine collected partial signatures into a fully-signed transaction.
 * Calls `POST /api/multisig/combine`.
 */
export async function combineMultisigSigs(
  proposal: MultisigSpendProposal,
  partialSigs: string[],
): Promise<string> {
  if (partialSigs.length === 0) throw new Error("Need at least one signature");
  const res = (await apiPostJson("/api/multisig/combine", {
    tx_blob_hex: proposal.txBlobHex,
    partial_sigs_hex: partialSigs,
  })) as { signed_tx_blob_hex: string };
  return res.signed_tx_blob_hex;
}

/** Submit a fully signed multisig transaction to the network. */
export async function submitMultisigTx(txHex: string): Promise<{ tx: string }> {
  const res = (await apiPostJson("/api/multisig/submit", {
    signed_tx_blob_hex: txHex,
  })) as { tx_id_hex: string };
  return { tx: res.tx_id_hex };
}
