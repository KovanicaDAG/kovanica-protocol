# Explorer JSON API

The `kovanica-node explorer` serves a self-hosted BlockDAG explorer UI and a
JSON API over HTTP. All endpoints are read-only unless noted. Amounts are in
atoms (1 KVNC = 100_000_000 atoms).

Base URL: `http://<explorer-host>:<port>` (default `127.0.0.1:8080`).

## Common conventions

- Block and transaction ids are 64-character lowercase hex strings.
- Addresses may be supplied as 64-character hex or as `kvnc…dag` base58 strings.
- `timestamp_ms` is milliseconds since the UNIX epoch.
- `blue_score` is the GHOSTDAG selected-chain depth at the block.
- `chain_blue_work` is the cumulative blue work up to and including the block.

## Existing endpoints

### `GET /api/bootstrap`

Network bootstrap information for light clients and wallets.

Response:
```json
{
  "network": "kovanica-testnet",
  "genesis": "<hex>",
  "tip": "<hex>",
  "listen": "0.0.0.0:9000",
  "peers": ["seed.kovanica.online:9000"],
  "pow": true,
  "min_fee": 400,
  "atom": 100000000,
  "token": "KVNC",
  "k": 3
}
```

### `GET /api/head`

High-level chain head summary.

Response:
```json
{
  "network": "kovanica-testnet",
  "genesis": "<hex>",
  "tip": "<hex>",
  "blocks": 42,
  "min_fee": 400,
  "atom": 100000000
}
```

### `GET /api/state`

Full explorer snapshot used to render the UI.

Query parameters:
- `node` — switch to this node before snapshotting.

Response: a large JSON object with mesh state, DAG topology, wallets, mempool,
and pending transactions.

### `GET /api/blocks`

Binary dump of every non-genesis block record in topological order
(`application/octet-stream`). Suitable for import into another node via
`receive_blocks`.

### `GET /api/history?address=<address>`

Full (unpaginated) delta history for an address.

Query parameters:
- `address` (required) — hex or `kvnc…dag` address.
- `node` — node name to query.

Response:
```json
{
  "address": "<hex>",
  "balance": 100000000,
  "txs": [
    {"block": "<hex>", "tx": "<hex>", "kind": "in", "delta": 100000000}
  ]
}
```

### `GET /api/utxos?address=<address>`

Unspent outputs for an address.

Query parameters:
- `address` (required).
- `node` — node name to query.

Response:
```json
{
  "address": "<hex>",
  "balance": 100000000,
  "utxos": [
    {"tx": "<hex>", "index": 0, "value": 100000000}
  ]
}
```

## Detail endpoints

### `GET /api/block/:id`

Detailed block header and topology.

Response:
```json
{
  "id": "<hex>",
  "prev_hash": "<hex>",
  "merkle_root": "<hex>",
  "height": 1,
  "timestamp_ms": 1699999999999,
  "nonce": 12345,
  "blue_score": 1,
  "chain_blue_work": "2",
  "work": "1",
  "parents": ["<hex>"],
  "children": ["<hex>"],
  "txs": ["<hex>"],
  "kind": "pow",
  "colour": "chain",
  "confirming_status": "confirmed"
}
```

Fields:
- `id` — block hash.
- `prev_hash` — selected parent hash (genesis is all-zero).
- `merkle_root` — BLAKE3 Merkle root over the block's transaction ids.
- `height` — selected-chain height (0 = genesis).
- `timestamp_ms`, `nonce`, `work` — consensus header fields.
- `blue_score`, `chain_blue_work` — GHOSTDAG scores.
- `parents`, `children` — parent and child block ids.
- `txs` — transaction ids in the block.
- `kind` — `"pow"` or `"staked"` depending on admission path.
- `colour` — `"genesis"`, `"chain"`, `"blue"`, or `"red"`.
- `confirming_status` — `"tip"`, `"confirmed"`, `"accepted"`, or `"pending"`.

### `GET /api/tx/:id`

Transaction inputs, outputs, addresses, amount, fee, and confirmation info.

Response:
```json
{
  "id": "<hex>",
  "coinbase": false,
  "confirmed": true,
  "confirmations": 3,
  "block": "<hex>",
  "blue_score": 5,
  "amount": 100000000,
  "fee": 400,
  "addresses": ["<hex>"],
  "inputs": [
    {"tx": "<hex>", "index": 0, "prev_owner": "<hex>", "value": 200000000}
  ],
  "outputs": [
    {"value": 100000000, "owner": "<hex>"}
  ],
  "size": 237
}
```

Fields:
- `amount` — total value of all outputs.
- `fee` — `sum(input values) - amount`; `0` for coinbase transactions.
- `addresses` — distinct addresses appearing as inputs or outputs.
- `inputs` — each input names the spent outpoint, its previous owner, and value
  when known. For unconfirmed mempool transactions the value is taken from the
  current UTXO set.
- `outputs` — created outputs with value and owner.
- `confirmations` — `tip_blue_score - block_blue_score + 1` for confirmed txs,
  `0` for mempool txs.

### `GET /api/address/:address`

Address balance and paginated history.

Query parameters:
- `page` — 1-based page number (default `1`).
- `per_page` — page size, clamped to `1..=100` (default `20`).
- `node` — node name to query.

Response:
```json
{
  "address": "<hex>",
  "balance": 100000000,
  "page": 1,
  "per_page": 20,
  "total": 5,
  "pages": 1,
  "txs": [
    {"tx": "<hex>", "block": "<hex>", "kind": "in", "amount": 100000000}
  ]
}
```

History items use `kind: "in"` for credits and `kind: "out"` for debits. Debit
amounts are the full value of the consumed inputs; any change back to the same
address appears as a separate `in` item.

## Fee market endpoints

### `GET /api/fee_estimate`

Estimated competitive fee rate based on the current mempool.

Query parameters:
- `node` — node name to query.

Response:
```json
{
  "fee_rate": 5,
  "unit": "atoms/byte",
  "mempool": 12,
  "bytes": 2847
}
```

`fee_rate` is the 75th percentile fee rate of pending transactions when the
mempool is at capacity, otherwise it falls back to the configured minimum fee
rate. Wallets can use it to set a competitive fee for the next block.


## Write endpoints

The explorer also exposes `POST` endpoints used by the web UI and mining
integration: `/api/faucet`, `/api/prepare`, `/api/submit`, `/api/produce`,
`/api/mine/template`, `/api/mine/submit`, `/api/submit_tx`, and the multisig
wallet endpoints. Their request/response shapes are documented by the UI code
and the mining-template integration tests.
