# KVP-102 HTTP `asset_id`

Branch: `api/kvp-102-asset-id`

## Apply source changes

```bash
git checkout api/kvp-102-asset-id
git apply docs/patches/kvp-102-asset-id.patch
cargo test -p kovanica-node
```

Or use the verified patch from the PR description.

## What changes

- `GET /api/utxos` — `asset_id` per UTXO + `balances` map (keeps scalar `balance`)
- `GET /api/history` — `asset_id` per row + `balances`
- `POST /api/prepare` — optional `asset_id` (default KVNC)
- Node helpers: `asset_id_to_wire`, `asset_id_from_wire`, `utxos_detailed_of`, `balances_map_of`
- Tests: `crates/kovanica-node/tests/multi_asset_coin_selection.rs`

## Safety

No consensus / RFC-006 / checkpoint changes. Additive JSON only.
