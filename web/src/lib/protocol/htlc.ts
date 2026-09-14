import { apiPostJson } from "@/lib/api/client";

export type HtlcCreateResult = {
  address: string;
  redeemScriptHex: string;
  paymentHashHex: string;
  receiverPubkeyHex: string;
  timeoutBlocks: number;
  amountAtoms: number;
};

export type HtlcRedeemResult = {
  txIdHex: string;
  preimageHex: string;
};

export type HtlcRefundResult = {
  txIdHex: string;
};

export async function createHtlc(params: {
  paymentHashHex: string;
  receiverPubkeyHex: string;
  amountAtoms: number;
  timeoutBlocks: number;
  senderPubkeyHex?: string;
}): Promise<HtlcCreateResult> {
  const hash = params.paymentHashHex.trim().toLowerCase();
  const receiver = params.receiverPubkeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("Payment hash must be 64-char hex (SHA-256)");
  }
  if (!/^[0-9a-f]{64}$/.test(receiver)) {
    throw new Error("Receiver pubkey must be 64-char hex");
  }
  if (params.amountAtoms <= 0) throw new Error("Amount must be positive");
  if (params.timeoutBlocks < 1) throw new Error("Timeout must be ≥ 1 block");

  const res = (await apiPostJson("/api/htlc/create", {
    payment_hash_hex: hash,
    receiver_pubkey_hex: receiver,
    amount_atoms: params.amountAtoms,
    timeout_blocks: params.timeoutBlocks,
    sender_pubkey_hex: params.senderPubkeyHex?.trim().toLowerCase() || undefined,
  })) as {
    address: string;
    redeem_script_hex: string;
    payment_hash_hex: string;
    receiver_pubkey_hex: string;
    timeout_blocks: number;
    amount_atoms: number;
  };

  return {
    address: res.address,
    redeemScriptHex: res.redeem_script_hex,
    paymentHashHex: res.payment_hash_hex,
    receiverPubkeyHex: res.receiver_pubkey_hex,
    timeoutBlocks: res.timeout_blocks,
    amountAtoms: res.amount_atoms,
  };
}

/**
 * Redeem requires the receiver's signing secret so the node can authorize the spend.
 * Omitting it would either reject every request or allow any observer to redirect funds.
 */
export async function redeemHtlc(params: {
  outpointTx: string;
  outpointIndex: number;
  preimageHex: string;
  receiverSecretHex: string;
}): Promise<HtlcRedeemResult> {
  const preimage = params.preimageHex.trim().toLowerCase();
  const secret = params.receiverSecretHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(preimage)) {
    throw new Error("Preimage must be 64-char hex");
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error("Receiver secret (32-byte seed hex) is required to authorize redeem");
  }
  const res = (await apiPostJson("/api/htlc/redeem", {
    outpoint: { tx: params.outpointTx.trim(), index: params.outpointIndex },
    preimage_hex: preimage,
    receiver_secret_hex: secret,
  })) as { tx_id_hex: string; preimage_hex: string };

  return { txIdHex: res.tx_id_hex, preimageHex: res.preimage_hex };
}

/** Refund requires the original sender's signing secret. */
export async function refundHtlc(params: {
  outpointTx: string;
  outpointIndex: number;
  senderSecretHex: string;
}): Promise<HtlcRefundResult> {
  const secret = params.senderSecretHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error("Sender secret (32-byte seed hex) is required to authorize refund");
  }
  const res = (await apiPostJson("/api/htlc/refund", {
    outpoint: { tx: params.outpointTx.trim(), index: params.outpointIndex },
    sender_secret_hex: secret,
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
