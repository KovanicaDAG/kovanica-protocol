# Deploy KVP-102 asset_id HTTP (PR #103)

## A. Finish the PR branch (one-time)

```bash
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
git fetch origin api/kvp-102-asset-id
git checkout api/kvp-102-asset-id
git apply docs/patches/kvp-102-asset-id.patch
git add crates/kovanica-node/src/node.rs crates/kovanica-node/src/explorer.rs
git commit -m "api(kvp-102): apply asset_id HTTP surface in node + explorer"
git push origin api/kvp-102-asset-id
```

Then merge PR https://github.com/KovanicaDAG/kovanica-protocol/pull/103

## B. Auto-deploy (preferred)

Per `OPERATIONS.md`, push to **main** runs `.github/workflows/deploy.yml` when
`DEPLOY_ENABLED=true`:

1. cargo test / clippy / fmt
2. release build
3. scp binary to VPS `145.223.116.178` (SSH **port 2222**)
4. atomic install to `/usr/local/bin/kovanica-node`
5. `systemctl restart kovanica-explorer` (+ seed2)

**No manual VPS login required** if Actions secrets are set.

## C. Manual VPS deploy (if Actions is off)

```bash
ssh -p 2222 root@145.223.116.178

cd /root/kovanica-protocol
git fetch origin main && git checkout main && git pull
cargo build --release -p kovanica-node

systemctl stop kovanica-explorer
install -m 755 target/release/kovanica-node /usr/local/bin/kovanica-node.new
mv /usr/local/bin/kovanica-node.new /usr/local/bin/kovanica-node
systemctl start kovanica-explorer
systemctl restart kovanica-seed2

curl -sS http://127.0.0.1:8080/api/head | head
curl -sS "http://127.0.0.1:8080/api/utxos?address=<hex>" | jq 'keys'
```

## D. Smoke after deploy

```bash
curl -sS "https://explorer.kovanica.online/api/utxos?address=<addr>" | jq '.balances, .utxos[0]'
curl -sS "https://explorer.kovanica.online/api/prepare?from=<a>&to=<b>&amount=1000" | jq .
curl -sS "https://explorer.kovanica.online/api/prepare?from=<a>&to=<b>&amount=1000&asset_id=KVNC" | jq .
```

## Safety

No chain reset. Additive JSON only. Independent of RFC-006 tokenomics branch.
