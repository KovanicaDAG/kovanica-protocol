import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { hexToKvnc } from "./address";
import { signSighash } from "./keys";

export type MultisigOutput = {
  to: string;
  atoms: number;
};

export type MultisigAddressResult = {
  address: string;
  redeemScript: string;
  threshold: number;
  pubkeys: string[];
};

export type MultisigSpendProposal = {
  sighash: string;
  tx: string;
  from: string;
  outputs: MultisigOutput[];
};

/**
 * Build a P2SH-style multisig address from a threshold and cosigner pubkeys.
 * Address format mirrors kovanica-state: 0x01 || BLAKE3(redeem_script) as a
 * versioned 33-byte address.
 *
 * TODO(@fixer): replace with real FFI call or node endpoint once available.
 */
export async function createMultisigAddress(
  threshold: number,
  pubkeys: string[],
): Promise<MultisigAddressResult> {
  const clean = pubkeys.map((p) => p.trim().toLowerCase()).filter((p) => /^[0-9a-f]{64}$/.test(p));
  if (threshold < 1 || threshold > clean.length || clean.length > 16) {
    throw new Error("Invalid M-of-N: need 1 <= M <= N <= 16");
  }
  // Redeem script layout: [M (1B), N (1B), pk_1 (32B), …, pk_N (32B)]
  const script = new Uint8Array(2 + clean.length * 32);
  script[0] = threshold;
  script[1] = clean.length;
  for (let i = 0; i < clean.length; i++) {
    const bytes = new Uint8Array(32);
    for (let j = 0; j < 32; j++) {
      bytes[j] = parseInt(clean[i].slice(j * 2, j * 2 + 2), 16);
    }
    script.set(bytes, 2 + i * 32);
  }
  const hash = blake3(script);
  const versioned = new Uint8Array(33);
  versioned[0] = 0x01;
  versioned.set(hash, 1);
  const address = hexToKvnc(bytesToHex(versioned));
  return { address, redeemScript: bytesToHex(script), threshold, pubkeys: clean };
}

/**
 * Initiate a spend from a multisig address. Returns a sighash for cosigners.
 *
 * TODO(@fixer): wire to node/FFI buildMultisigSpend endpoint.
 */
export async function buildMultisigSpend(
  from: string,
  outputs: MultisigOutput[],
): Promise<MultisigSpendProposal> {
  if (outputs.length === 0 || outputs.some((o) => !o.to || o.atoms <= 0)) {
    throw new Error("Need at least one valid output");
  }
  // Stub sighash = BLAKE3 of inputs; fixer should replace with real tx building.
  const payload = JSON.stringify({ from, outputs });
  const sighash = bytesToHex(blake3(new TextEncoder().encode(payload)));
  return { sighash, tx: "", from, outputs };
}

/**
 * Create one partial Ed25519 signature for a multisig sighash using a mnemonic.
 *
 * TODO(@fixer): this currently reuses the single-key signSighash helper. Replace
 * with dedicated partial-signature FFI when available.
 */
export async function signMultisigPartial(
  mnemonic: string,
  index: number,
  sighash: string,
): Promise<string> {
  return signSighash(mnemonic, index, sighash);
}

/**
 * Combine collected partial signatures and submit the final transaction.
 *
 * TODO(@fixer): wire to node/FFI combineMultisigSigs + submitMultisigTx.
 */
export async function combineMultisigSigs(
  proposal: MultisigSpendProposal,
  partialSigs: string[],
): Promise<string> {
  if (partialSigs.length === 0) throw new Error("Need at least one signature");
  // Stub: return a fake encoded tx. Fixer should assemble the real witness tx.
  return bytesToHex(blake3(new TextEncoder().encode(JSON.stringify({ proposal, partialSigs }))));
}

/** Submit a fully signed multisig transaction to the network. */
export async function submitMultisigTx(txHex: string): Promise<{ tx: string }> {
  // TODO(@fixer): call POST /api/multisig/submit or FFI equivalent.
  void txHex;
  return { tx: "" };
}
