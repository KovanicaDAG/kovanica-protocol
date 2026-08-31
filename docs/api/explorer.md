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
