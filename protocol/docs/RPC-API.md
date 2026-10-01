# Kovanica RPC / HTTP API Reference

> **One-line summary:** Complete reference for the Kovanica node HTTP API (explorer), line RPC, and WebSocket interfaces.
>
> **Status:** Draft
>
> **Consensus impact:** none (API documentation only)

---

## 1. Transport & Conventions

### 1.1 HTTP API (Explorer)
- **Base URL:** `http://<node>:8080` (participant) or `https://explorer.kovanica.online` (public)
- **Content-Type:** `application/json` for requests, `application/json` or `application/octet-stream` for responses
- **Rate limiting:** Token bucket (default 10 req/s, burst 60) per IP
- **Errors:** `{ "ok": false, "error": "<message>" }` with appropriate HTTP status

### 1.2 Line RPC (REPL)
- **Transport:** stdin/stdout (text lines)
- **Invocation:** `./kovanica-node` or `cargo run -p kovanica-node`
- **Format:** One command per line, response per line
- **Response prefix:** `ok ` or `err `

### 1.3 WebSocket
- **Endpoint:** `/ws`
- **Protocol:** Text frames, JSON messages with `type` field
- **Message types:** `block`, `tx`, `tip`, `peer`, `state`, `ping`, `pong`

### 1.4 Wire Format (Binary)
- **Used by:** `/api/blocks`, `/api/mine/submit` (octet-stream), `/api/light_sync`, P2P sync
- **Framing:** `encode_records` / `decode_records` (length-prefixed blocks)
- **Block record:** parents[], work, timestamp_ms, nonce, vrf?, txs[]

---

## 2. HTTP API Endpoints

### 2.1 Chain Info

#### `GET /api/head`
Current chain tip and basic info.

**Response:**
```json
{
  "network": "kovanica-testnet",
  "genesis": "9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97",
  "tip": "a1b2c3d4...",
  "blocks": 12345,
  "min_fee": 40000,
  "atom": 100000000
}
```

#### `GET /api/bootstrap`
Full bootstrap blob for new nodes and light clients.

**Response:**
```json
{
  "network": "kovanica-testnet",
  "genesis": "9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97",
  "tip": "a1b2c3d4...",
  "listen": "0.0.0.0:9000,[::]:9000",
  "peers": ["seed.kovanica.online:9000", "seed2.kovanica.online:9000"],
  "pow": true,
  "min_fee": 40000,
  "atom": 100000000,
  "token": "KVNC",
  "k": 3,
  "subsidy": 1000000000,
  "founder_amount": 20000000000000000,
  "founder_seed": 1,
  "finality_depth": 100,
  "payload_pruning_depth": 1000,
  "native_minted": 123456789012345678,
  "total": 123456789012345678,
  "circulating": 120000000000000000,
  "burned": 3456789012345678,
  "max_supply": 90200000000000000000,
  "operator_wallet_address": "kvnc...",
  "light_config": {
    "k": 3,
    "subsidy": 1000000000,
    "premine": 20000000000000000,
    "founder_seed": 1,
    "finality_depth": 100,
    "payload_pruning_depth": 1000
  }
}
```

#### `GET /api/state`
Full DAG snapshot (blocks, tips, blue scores, mempool). Large response.

#### `GET /api/p2p`
P2P status.

**Response:**
```json
{
  "path": "tcp",
  "listen": "0.0.0.0:9000,[::]:9000",
  "peers": ["seed2.kovanica.online:9000"],
  "bootstrap": "seed.kovanica.online:9000,seed2.kovanica.online:9000"
}
```

### 2.2 Block & Transaction Data

#### `GET /api/blocks`
Binary block dump (wire format). Use for cold bootstrap.

**Query params:**
- `from=<block_id_hex>` -- Incremental dump from block (exclusive)

**Response:** `application/octet-stream` (length-prefixed block records)

#### `GET /api/block/<block_id>`
Block detail (JSON).

#### `GET /api/tx/<tx_id>`
Transaction detail (JSON).

#### `GET /api/address/<address>`
Address detail, balance, history.

**Query params:**
- `asset_id=<hex>` -- Filter by asset (KVP-102)

### 2.3 Wallet Operations

#### `GET /api/balance`
Spendable balance for address.

**Query params:** `address=<kvnc...>` (required)

**Response:** `{ "ok": true, "balance": "5000000000" }`

#### `GET /api/utxos`
UTXO set for address.

**Query params:** `address=<kvnc...>` (required), `asset_id=<hex>` (optional)

#### `GET /api/history`
Transaction history for address.

**Query params:** `address=<kvnc...>` (required), `asset_id=<hex>`, `limit=<int>`, `offset=<int>`

#### `POST /api/prepare`
Build unsigned transaction (native or asset).

**Request:** `{ "from": "kvnc...", "to": "kvnc...", "amount": 100000000, "asset_id": null }`

**Response:** `{ "ok": true, "sighash": "...", "value": 100000000, "fee": 40000, "fee_asset_id": "KVNC", "change": 99960000, "asset_id": "KVNC", "outpoint": {...} }`

#### `POST /api/submit_tx`
Submit signed transaction.

**Request:** `{ "tx_hex": "<signed-transaction-hex>" }`

**Response:** `{ "ok": true, "tx": "txid..." }`

#### `POST /api/faucet`
Request testnet KVNC (1 KVNC, rate-limited).

**Request:** `{ "address": "kvnc..." }`

**Response:** `{ "ok": true, "tx": "txid..." }`

### 2.4 Mining

#### `GET /api/mine/template`
Get mining template for external miners.

**Query params:** `node=<name>`, `miner=<address>`

#### `POST /api/mine/submit`
Submit mined block.

**Content-Type:** `application/json` (PoW) or `application/octet-stream` (wire format with VRF)

### 2.5 Fee Estimation

#### `GET /api/fee_estimate`
Fee estimation (slow/normal/fast in atoms/byte).

**Response:** `{ "ok": true, "slow": 40000, "normal": 80000, "fast": 120000 }`

### 2.6 Light Client (SPV)

#### `GET /api/light_sync`
SPV light-sync blob (KVLS v1 format).

**Query params:** `from=<block_id_hex>`

**Response:** `application/octet-stream` (KVLS v1 blob)

#### `GET /api/light_proof`
Merkle inclusion proof for transaction.

**Query params:** `block=<block_id_hex>`, `tx=<tx_id_hex>`

**Response:** `application/octet-stream` (merkle proof blob)

### 2.7 Multisig Wallet

#### `POST /api/multisig/create` -- Create M-of-N multisig address
#### `POST /api/multisig/build` -- Build multisig spend (unsigned)
#### `POST /api/multisig/sign` -- Sign multisig partially
#### `POST /api/multisig/combine` -- Combine partial signatures
#### `POST /api/multisig/submit` -- Submit fully signed multisig

### 2.8 Metrics

#### `GET /metrics`
Prometheus metrics endpoint.

---

## 3. Line RPC Commands

Run `./kovanica-node` for interactive REPL. All responses prefixed with `ok ` or `err `.

### 3.1 Core Commands
`help`, `genesis <k> <subsidy> <amount> <seed>`, `genesis_finality <k> <subsidy> <amount> <seed> <finality_depth>`, `address <seed>`, `balance <seed|addr-hex>`, `send <from-seed> <amount> <to-seed>`, `pool <from-seed> <amount> <to-seed>`, `produce`, `pending`, `tips`, `tip`, `len`, `staking [vrf-pk-hex]`, `save <path>`, `load <path>`, `checkpoint <path>`, `load_checkpoint <path>`

### 3.2 HTLC Commands (RFC-004)
`htlc_create <from-seed> <amount> <recipient-pk-hex> <preimage-hash-hex> <timeout>`
`htlc_redeem <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <preimage-hex> <to-addr>`
`htlc_refund <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr>`
`htlc_balance <script-hex>`

### 3.3 Vault Commands (RFC-005)
`vault_create <from-seed> <amount> <unlock-height> <csv> <owner-pk-hex>`
`vault_release <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr>`
`vault_balance <script-hex>`

---

## 4. WebSocket API

**Endpoint:** `ws://<node>:8080/ws`

**Message Types:** `block` (id, blue_score), `tx` (id, from, to, amount), `tip` (id, blue_score), `peer` (addr, connected), `state` (snapshot), `ping`/`pong`

---

## 5. Wire Format (Binary)

Used by `/api/blocks`, `/api/mine/submit` (octet-stream), P2P sync. See `encode_records` / `decode_records` in `kovanica-node/src/net.rs`.

---

## 6. Error Codes

| HTTP Status | Error Message | Meaning |
|-------------|---------------|---------|
| 400 | `invalid json body` | Malformed JSON |
| 400 | `missing '<field>' field` | Required field absent |
| 400 | `undecodable transaction` | TX hex invalid |
| 400 | `rate limit exceeded` | Token bucket exhausted |
| 404 | `block not found` | Block ID unknown |
| 404 | `tx not found` | TX ID unknown |
| 404 | `address not found` | Address not in index |
| 429 | `rate limit exceeded` | Per-IP bucket empty |
| 500 | `internal error` | Node panic / consensus error |

---

## 7. Client Implementation Notes

### 7.1 Address Handling
- Accept both `kvnc...dag` (base58) and 64-hex / 66-hex forms
- `Address::parse()` handles all formats
- Always validate address before sending

### 7.2 Transaction Flow
1. `POST /api/prepare` -> get `sighash` and `outpoint`
2. Sign `sighash` with Ed25519 (signature = 128 hex chars)
3. Attach signature to witness
4. `POST /api/submit_tx` with full signed TX hex

### 7.3 Fee Calculation
- Fee floor: `max(1, subsidy / 500000)` atoms/byte
- Use `/api/fee_estimate` for market rates
- Fees paid in native KVNC only (KVP-102)

### 7.4 Asset Support (KVP-102)
- Include `asset_id` in `/api/prepare` for non-native assets
- `asset_id` = 32-byte hex (lowercase) or `null` for KVNC
- Balance/history/utxos endpoints accept `asset_id` filter

---

## 8. Related Documents

- [TESTNET-GUIDE.md](./TESTNET-GUIDE.md)
- [NODE-OPERATOR.md](./NODE-OPERATOR.md)
- [ADDRESS-FORMAT.md](./ADDRESS-FORMAT.md)
- [SPEC-INDEX.md](./SPEC-INDEX.md)

---

*Last updated: 2026-09-21 | Network: kovanica-testnet*
