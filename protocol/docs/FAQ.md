# Kovanica Testnet FAQ

> **One-line summary:** Common questions and answers for testnet users, operators, and developers.
>
> **Status:** Draft
>
> **Consensus impact:** none (documentation only)

---

## 1. Getting Started

### Q: How do I join the testnet?
**A:** Run the one-line installer:
```sh
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash
~/kovanica-node/run.sh
```
Then open http://127.0.0.1:8080 and verify with `curl -s http://127.0.0.1:8080/api/head`.

### Q: What are the bootstrap peers?
**A:** 
- `seed.kovanica.online:9000` (primary)
- `seed2.kovanica.online:9000` (secondary)

Use `KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000`.

### Q: Why does my node stall at genesis?
**A:** Common causes:
- Dialing a Cloudflare-proxied hostname (use `seed.kovanica.online`, not `explorer.kovanica.online`)
- IPv6 resolution stall on Ubuntu (use origin IP: `145.223.116.178:9000`)
- Wrong `KOVANICA_PEERS` value

### Q: Do I need to open inbound port 9000?
**A:** Only if you want to serve other peers. Outbound 9000 to the seed is sufficient for sync.

---

## 2. Wallets & Addresses

### Q: What address formats are accepted?
**A:** All of these work:
- `kvnc...dag` (base58, preferred)
- 66-hex (33 bytes = version + payload)
- 64-hex (legacy P2PK, treated as version 0x00)

### Q: What is the difference between `kvnc...dag` and hex?
**A:** `kvnc...dag` is a base58 encoding of the versioned address bytes with a checksum. The hex form is the raw bytes. Both represent the same address.

### Q: Can I use the same address on mainnet and testnet?
**A:** Address format is identical, but the networks are completely separate. Testnet KVNC has no value on mainnet.

### Q: How do I get testnet KVNC?
**A:** Use the faucet:
```sh
curl -X POST https://explorer.kovanica.online/api/faucet \
  -H "Content-Type: application/json" \
  -d '{"address": "kvnc..."}'
```
Pays 1 KVNC from operator funds. Rate-limited per address.

---

## 3. Transactions

### Q: How do I send a transaction?
**A:** Standard flow (keys stay client-side):
1. `POST /api/prepare` with `from`, `to`, `amount` -- returns `sighash` and `outpoint`
2. Sign `sighash` with Ed25519 (64-byte signature = 128 hex chars)
3. `POST /api/submit_tx` with signed transaction hex

### Q: What is the fee?
**A:** Fee floor = `max(1, subsidy / 500000)` atoms/byte. At genesis (10 KVNC subsidy): 2000 atoms/byte. Use `/api/fee_estimate` for market rates (slow/normal/fast).

### Q: Can I send assets (KVP-102)?
**A:** Yes. Include `asset_id` in `/api/prepare`. `asset_id` = 32-byte hex or `null` for native KVNC. Fees always paid in native KVNC.

### Q: Why is my transaction rejected with "AssetNotConserved"?
**A:** Each asset must be conserved independently. You cannot mint assets in regular transactions (only coinbase can). Burning (output < input) is allowed.

---

## 4. Block Production & Staking

### Q: How do I produce blocks?
**A:** There is no mining -- Kovanica is proof-of-authority. To produce
blocks your node must (a) hold the authority key scheduled for the slot,
via `KOVANICA_AUTHORITY_KEY`, and (b) be set to produce, with
`KOVANICA_PRODUCE=1` and `KOVANICA_PRODUCE_SECS=<interval>` (the
pre-PoA aliases `KOVANICA_MINE` / `KOVANICA_MINE_SECS` still work). A node
without the scheduled key produces nothing. There is no proof-of-work and
no difficulty retarget.

### Q: What is the block reward?
**A:** RFC-006 emission curve:
- Genesis subsidy: 10 KVNC/block
- Era: 2,050,000 blocks
- Decay: 3/4 per era (geometric)
- Fee split: 75% burned / 25% to producer

### Q: What is hybrid staking?
**A:** Hybrid PoW + VRF-staked admission. Set `KOVANICA_HYBRID=1` and `KOVANICA_VALIDATOR_SEED=<your-vrf-seed>`. Bond KVNC via stake registry to participate in VRF sortition.

### Q: How do I bond stake?
**A:** Use the stake registry (tag convention `KVB1 || vrf_pk`). The node's `bond_stake` helper handles splitting and bonding. Requires 100-block maturity before unbonding.

---

## 5. Node Operations

### Q: Where is my chain data stored?
**A:** In `KOVANICA_DATA` (default `./data` or `~/kovanica-node/data`). **Never put this inside a git repo.**

### Q: How do I backup my node?
**A:** 
```sh
KOV_BACKUP_PASSPHRASE="..." ./scripts/backup-node.sh --data /path/to/data
```
Restores are encrypted. Run a restore drill quarterly.

### Q: How do I upgrade the binary?
**A:**
```sh
systemctl stop kovanica-node
cargo build --release -p kovanica-node
sudo install -m755 target/release/kovanica-node /usr/local/bin/kovanica-node.new
sudo mv -f /usr/local/bin/kovanica-node{.new,}
systemctl start kovanica-node
```
Always stop the service before replacing the binary.

### Q: What ports does the node use?
**A:**
- 9000 (TCP) -- P2P gossip
- 8080 (HTTP, loopback) -- Explorer API
- 9090 (HTTP, loopback) -- Prometheus metrics
- 3000 (HTTP, loopback) -- Web UI (separate pm2 process)

---

## 6. Consensus & Protocol

### Q: What consensus does Kovanica use?
**A:** GHOSTDAG BlockDAG with parameter **k=3**. Blocks reference multiple parents, enabling parallel block production.

### Q: What is finality?
**A:** 100 blocks (blue score depth). Blocks deeper than 100 below the tip are final and cannot be reorged.

### Q: What is the max supply?
**A:** 90.2M KVNC (90,200,000,000,000,000 atoms). Hard cap enforced via `native_minted` tracking.

### Q: What is coinbase maturity?
**A:** 100 blocks. Coinbase outputs cannot be spent until 100 blocks after their creation height.

### Q: Are there halving events?
**A:** Smooth geometric decay (3/4 per era of 2M blocks), not discrete halvings.

---

## 7. Advanced Features

### Q: What is a multisig address?
**A:** M-of-N threshold signature (RFC-001). Version 0x01 (P2SH). Create via `/api/multisig/create`, spend via witness with redeem script + M signatures.

### Q: What are stealth addresses?
**A:** CryptoNote-style one-time keys (RFC-003). Recipient publishes scan/spend keys; sender derives one-time output key per payment. Version 0x03.

### Q: What is an HTLC?
**A:** Hash Time-Locked Contract (RFC-004). Locks funds behind preimage hash + timeout. Redeem with preimage, refund after timeout. Version 0x04.

### Q: What is a vault?
**A:** Time-lock vault with absolute (CLTV) and/or relative (CSV) locks (RFC-005). Version 0x05. Both locks must elapse to spend.

### Q: What is Script v2?
**A:** Bounded stack machine (RFC-003). Opcodes: ED25519_VERIFY, CLTV, CSV, HASH_BLAKE3, EQUAL, AND, OR, THRESHOLD. Version 0x02.

---

## 8. Troubleshooting

### Q: "address already in use" on port 9000
**A:** Another node is running. Stop it: `systemctl stop kovanica-*` or change `KOVANICA_LISTEN`.

### Q: Genesis mismatch after restart
**A:** Old chain data in `KOVANICA_DATA`. Wipe data dir (use reset flag on isolated host only) or restore from backup.

### Q: No peers connecting
**A:** You're dialing a Cloudflare-proxied hostname. Use `seed.kovanica.online` (grey-cloud DNS only).

### Q: Miner not producing blocks
**A:** Check `KOVANICA_MINE=1` and mempool has transactions (or call `produce_empty` via RPC).

### Q: Metrics not appearing
**A:** `metrics` crate version mismatch. Ensure `metrics` and `metrics-exporter-prometheus` share minor version.

---

## 9. Network & Domains

### Q: What are the live domains?
**A:**
- `kovanica.online` -- Landing page
- `testnet.kovanica.online` -- Full testnet surface (explorer, wallet, tools)
- `explorer.kovanica.online` -- Block explorer (shared)
- `wallet.kovanica.online` -- Web wallet (shared)
- `api.kovanica.online` -- Public HTTP API
- `faucet.testnet.kovanica.online` -- Testnet faucet
- `docs.kovanica.online` -- Specifications
- `seed.kovanica.online` -- Primary P2P seed (grey-cloud)
- `seed2.kovanica.online` -- Secondary P2P seed (grey-cloud)

### Q: Why is `explorer.kovanica.online` not a P2P peer?
**A:** It's Cloudflare-orange-clouded. TCP 9000 doesn't pass through Cloudflare. Use `seed.kovanica.online` for P2P.

---

## 10. Development

### Q: Where is the protocol source code?
**A:** https://github.com/KovanicaDAG/kovanica-protocol (monorepo)

### Q: Where is the node binary source?
**A:** https://github.com/KovanicaDAG/kovanica-node (mirror, runnable node)

### Q: How do I build from source?
**A:**
```sh
git clone https://github.com/KovanicaDAG/kovanica-node.git
cd kovanica-node
cargo build --release -p kovanica-node
```

### Q: What Rust version is required?
**A:** 1.75+ (edition 2021). `rustup` recommended.

### Q: Are there mobile SDKs?
**A:** Yes, UniFFI bindings for Kotlin (Android) and Swift (iOS). See `kovanica-ffi` crate and `android-light-node` app.

---

## 11. Security

### Q: Does the node ever see my private key?
**A:** No. Private keys and seeds stay strictly client-side. The node only verifies signatures.

### Q: What is the signature format?
**A:** Ed25519, 64-byte signature = 128 hex characters. Sign the `sighash` (BLAKE3 of witness-free transaction encoding).

### Q: Can I use a hardware wallet?
**A:** Ledger/Trezor support is planned for the web wallet. CLI currently uses file-based seeds.

### Q: What happens if I lose my seed?
**A:** Funds are unrecoverable. Back up your seed (BIP-39 mnemonic or 32-byte hex) securely.

---

## 12. Testnet Reset Policy

### Q: Will the testnet reset?
**A:** Resets only occur on:
- Wire-format bumps (breaking encoding changes)
- Safety incidents requiring chain rewrite
- Major consensus upgrades with format changes

Policy: documented, announced, epoch-tagged (`kovanica-testnet-eN`).

### Q: What happens to my testnet KVNC after a reset?
**A:** Testnet KVNC has no monetary value. Resets wipe all balances. Use the faucet after reset.

---

*Last updated: 2026-09-21 | Network: kovanica-testnet*
