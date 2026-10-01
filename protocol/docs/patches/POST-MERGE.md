# PR #103 merged — HTTP source still needs apply

PR #103 merged **docs + tests + patch file only**.
`crates/kovanica-node/src/{node,explorer}.rs` on `main` do **not** yet contain `utxos_detailed_of` / prepare `asset_id`.

## Apply and ship (required for live API)

```bash
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
git checkout main && git pull
bash scripts/apply-kvp102-asset-id.sh
# or: git apply docs/patches/kvp-102-asset-id.patch
cargo test -p kovanica-node
git checkout -b api/kvp-102-asset-id-apply
git add crates/kovanica-node/src/node.rs crates/kovanica-node/src/explorer.rs
git commit -m "api(kvp-102): apply asset_id HTTP surface in node + explorer"
git push -u origin api/kvp-102-asset-id-apply
# open PR → merge to main → deploy.yml ships binary
```

Until that lands, `https://explorer.kovanica.online/api/utxos` will not return `balances` / `asset_id`.
