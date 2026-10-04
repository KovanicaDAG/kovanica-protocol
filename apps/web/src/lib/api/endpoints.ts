/** Endpoint catalog shared by docs and the api-reference playground. */
export type EndpointRow = {
  method: "GET" | "POST";
  path: string;
  note: string;
  /** Safe to run read-only in the playground. */
  read?: boolean;
};

export const ENDPOINTS: EndpointRow[] = [
  { method: "GET", path: "/api/head", note: "genesis, tip, height", read: true },
  { method: "GET", path: "/api/bootstrap", note: "plus listen, peers, upstream probe", read: true },
  { method: "GET", path: "/api/p2p", note: "TCP listen + bootstrap peers", read: true },
  { method: "GET", path: "/api/block/{id}", note: "typed block detail (S-02)", read: true },
  { method: "GET", path: "/api/tx/{id}", note: "typed transaction detail", read: true },
  {
    method: "GET",
    path: "/api/address/{addr}",
    note: "address summary (balance, txs)",
    read: true,
  },
  { method: "GET", path: "/api/blocks", note: "octet-stream dump (clone catch-up)" },
  { method: "GET", path: "/api/state", note: "full DAG + flags", read: true },
  { method: "GET", path: "/api/utxos?address=", note: "spendable outputs", read: true },
  { method: "GET", path: "/api/history?address=", note: "deltas per address", read: true },
  { method: "GET", path: "/api/fee_estimate", note: "RFC-006 fee floor, atoms/byte", read: true },
  { method: "GET", path: "/api/origins", note: "ISO3 pulses", read: true },
  { method: "GET", path: "/api/spec", note: "full protocol spec, text/plain", read: true },
  { method: "GET", path: "/api/collection/{id}", note: "KVP-106 collection metadata", read: true },
  { method: "GET", path: "/api/nft/{id}", note: "KVP-106 NFT metadata", read: true },
  { method: "GET", path: "/api/rwa/{id}", note: "RWA asset metadata", read: true },
  { method: "GET", path: "/api/light_proof", note: "SPV/light-node proof", read: true },
  { method: "GET", path: "/api/light_sync", note: "light-node sync slice", read: true },
  { method: "POST", path: "/api/prepare", note: "sighash + fee + change" },
  { method: "POST", path: "/api/submit", note: "queue signed tx" },
  { method: "POST", path: "/api/submit_tx", note: 'submit with {"tx_hex": …} (SDK parity)' },
  { method: "POST", path: "/api/produce", note: "pack mempool" },
  { method: "POST", path: "/api/mine", note: "mine a coinbase block on the selected node" },
  { method: "POST", path: "/api/faucet", note: "testnet open faucet" },
  { method: "POST", path: "/api/origin", note: "pulse a country" },
  { method: "POST", path: "/api/multisig/create", note: "M-of-N P2SH address from pubkeys" },
  { method: "POST", path: "/api/multisig/build", note: "build a multisig spend proposal" },
  { method: "POST", path: "/api/multisig/sign", note: "sign a multisig sighash" },
  { method: "POST", path: "/api/multisig/combine", note: "combine partial signatures" },
  { method: "POST", path: "/api/multisig/submit", note: "submit a combined multisig spend" },
];

/** Read-only endpoints available in the playground. */
export type PlaygroundEndpoint = {
  label: string;
  path: string;
  needsAddress: boolean;
  needsId?: boolean;
};

export const PLAYGROUND_ENDPOINTS: readonly PlaygroundEndpoint[] = [
  { label: "/api/head", path: "/api/head", needsAddress: false },
  { label: "/api/bootstrap", path: "/api/bootstrap", needsAddress: false },
  { label: "/api/state", path: "/api/state", needsAddress: false },
  { label: "/api/block/{id}", path: "/api/block", needsAddress: false, needsId: true },
  { label: "/api/fee_estimate", path: "/api/fee_estimate", needsAddress: false },
  { label: "/api/utxos", path: "/api/utxos", needsAddress: true },
  { label: "/api/history", path: "/api/history", needsAddress: true },
  { label: "/api/origins", path: "/api/origins", needsAddress: false },
  { label: "/api/p2p", path: "/api/p2p", needsAddress: false },
];
