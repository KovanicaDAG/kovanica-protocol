# Kovanica SDK — Cookbook (S-13 draft)

Practical recipes for building Kovanica-aware applications on top of
`kovanica-sdk`. Everything here is **client-only**: keys and seeds never leave
your process; the node only ever sees signed transactions and read-only API
calls.

Verified against SDK `0.1.0-alpha.1` (2026-09-23): `cargo test --workspace`
→ 67 passed; live suite 5/5 vs `api.kovanica.online`. All multi-asset recipes
below are merged and code-verified on this tree.

> **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> Proof-of-Work is being **removed**, not merely disabled. Items marked
> `[TARGET]` are ratified but not yet implemented; `[CURRENT]` items describe
> shipped code. Policy lives in
> [`../protocol/docs/RFC-POA-Migration.md` §0](../protocol/docs/RFC-POA-Migration.md).
>
> **SDK impact: none of the recipes below change.** Prepare → offline Ed25519
> sign → submit, the dual-balance/native-null model, and the KVP-101…105 script
> helpers are all consensus-agnostic client code. The only SDK-visible change is
> the node env block in §7 (`KOVANICA_POW` / `KOVANICA_MINE` are
> `[TARGET]`-for-removal; a plain participant node sets neither). Do not add
> work/difficulty fields to any recipe: a post-transition block has no work
> target, and `blue_work` stops being the thing to assert on. RFC-006
> tokenomics (**MAX_SUPPLY 90.2M KVNC**, s₀ **10 KVNC/block**, era
> **2 000 000**, **α 3/4**, maturity **100**, fee **75% burned / 25%
> producer**) and GHOSTDAG **k=3** are unchanged, so all fee/subsidy math in
> this cookbook stays valid.

---

## 1. Quick start

```rust
use kovanica_sdk::prelude::*;

let mnemonic = Mnemonic::generate(WordCount::Words24)?;
let keypair = Keypair::from_mnemonic(&mnemonic, ""); // !"" = no passphrase
println!("{}", keypair.address().to_hex());           // 66-hex (kvnc...dag by kovanica-keys)
```

Deterministic demo keys (tests / examples only — never ship fixed bytes):

```rust
fn demo_pair(k: u64) -> Keypair {                      // node parity: [k LE, 0..]
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}
```

## 2. Build → estimate → sign → submit

The canonical offline flow. The node never sees your key.

```rust
use kovanica_sdk::prelude::*;

let kp = demo_pair(1);
let utxo = Utxo {
    tx_hash: Hash32([0x01; 32]),           // from GET /api/utxos (see §7)
    vout: 0,
    amount: Amount::from_kvnc(10),
    asset_id: AssetId::NATIVE,
    address: kp.address(),
};

// 1. Build unsigned (fee floor handled below).
let tx = TransferBuilder::new()
    .network(NetworkId::Testnet)
    .add_input(utxo)
    .add_native_output(bob_addr, Amount::from_kvnc(5))
    .set_fee(Amount::from_atoms(2000))     // provisional; refine with kovanica-fee
    .set_change(kp.address())
    .build()?;

// 2. RFC-006 aware fee: max(1, subsidy/500_000) atoms/byte.
//    Era-0 subsidy is 10 KVNC = 1_000_000_000 atoms -> 2000 atoms/byte.
let fee = estimate(tx.encode().len() as u64, 1_000_000_000);

// 3. Sign offline: BLAKE3 sighash of the witness-free encoding.
let signed = SignedTx::sign(tx, &kp)?;
assert_eq!(signed.tx.inputs[0].witness[0].len(), 64); // Ed25519

// 4. Submit (network, but only the *signed* transaction leaves your machine).
//    POST /api/submit_tx {"tx_hex": "..."}
let client = Client::new("https://api.kovanica.online")?;
let txid = client.submit_tx(&signed).await?;
```

Always check maturity: coinbase outputs are spendable only 100 blocks after
their creation (RFC-006). `/api/utxos` rows do not carry `is_coinbase` — when
in doubt, keep the source of funds ≥ 100 blocks old.

## 3. Your first live API calls

```rust
let client = Client::testnet()?; // → https://api.kovanica.online

let head = client.get_head().await?;          // network, atom=1e8, min_fee, blocks
let boot = client.get_bootstrap().await?;     // k=3, subsidy, max_supply, peers
let fee  = client.get_fee_estimate().await?;  // {fee_rate, unit:"atoms/byte", mempool, bytes}
let page = client.get_utxos(&kp.address(), Some(100), Some(0)).await?;
```

`/api/bootstrap` is the live source of truth for tokenomics:

- `max_supply` = `9_020_000_000_000_000` atoms (90.2M KVNC — `90_200_000 * ATOM`)
- `subsidy` = `1_000_000_000` atoms (era 0 → fee floor 2000 atoms/byte)
- `k` = 3 (GHOSTDAG — do not hard-code anything else)
- supply invariants: `native_minted ≤ max_supply`, `total == native_minted`,
  `circulating ≤ total`

Read-only calls are safe; never POST anything but a transaction you fully
understand.

## 4. Multi-asset (KVP-102)

Assets are identified by a 32-byte id; native KVNC is the zero hash. The node's
wire form is `"KVNC"` for native, lowercase 64-hex otherwise.

Wire rows from `/api/utxos` convert straight into builder inputs:

```rust
Let owner = Address::from_hex(&page.address)?;   // 66-hex
let utxos: Vec<Utxo> = page.utxos.iter()
    .map(|row| row.into_domain(&owner))
    .collect::<Result<_, _>>()?;
```

Per-asset conservation is enforced by the builder: every non-native asset must
balance exactly; surplus comes back as change **in the same asset**; fees only
apply to native KVNC.

```rust
let tx = TransferBuilder::new()
    .network(NetworkId::Testnet)
    .add_input(asset_utxo)                       // Utxo { asset_id, .. }
    .add_output(bob, Amount::from_atoms(1200), asset)
    .set_change(alice.address())
    .build()?;                                   // change: 300 of the same asset
```

> On live networks the asset registry is genesis-seeded and issuance is
> operator-only (no public mint endpoint). Unregistered ids cannot be spent
> on-chain yet. Full runnable demos: `examples/transfer_asset.rs` and
> `examples/create_asset.rs`.

## 5. HTLC atomic swap (RFC-004 / KVP-104)

```rust
let htlc = HtlcScript::new(
    *blake3::hash(b"preimage").as_bytes(),   // preimage hash Bob must reveal
    bob_pk,                                  // recipient (redeemer)
    alice_pk,                                // refund owner (after timeout)
    1440,                                    // CLTV timeout height
)?;

let lock = HtlcBuilder::new(htlc)
    .network(NetworkId::Testnet)
    .add_input(alice_utxo)
    .amount(Amount::from_kvnc(4))
    .set_fee(Amount::from_atoms(10_000))
    .set_change(alice.address())
    .build()?;                               // locks to htlc.address() (0x04)

// Bob redeems: signs the sighash of an unsigned transfer spending the HTLC
// UTXO, revealing the preimage in the witness.
let redeem = TransferBuilder::new()
    .network(NetworkId::Testnet)
    .add_input(Utxo {
        tx_hash: TxHash::ZERO,               // = lock tx id in practice
        vout: 0,
        amount: Amount::from_kvnc(4),
        asset_id: AssetId::NATIVE,
        address: htlc.address(),
    })
    .add_native_output(bob.address(), Amount::from_kvnc(3))
    .set_fee(Amount::from_atoms(10_000))
    .set_change(bob.address())
    .build()?;
let bob_sig = bob.sign(&redeem.sighash()).0;              // [u8; 64]
let witness = htlc.redeem_witness(b"preimage", bob_sig);  // [template, preimage, sig]
assert_eq!(*blake3::hash(&witness[1]).as_bytes(), *htlc.preimage_hash());
```

End-to-end: `cargo run -p kovanica-sdk --example htlc_swap`.

## 6. Vaults (RFC-005 / KVP-105) and multisig (RFC-001)

Vault: CLTV unlock height + CSV relative lock, owned by one key.

```rust
let vault = VaultScript::new(1000, 144, owner_pk)?;  // CLTV 1000, CSV 144
let funding = VaultBuilder::new(vault)
    .network(NetworkId::Testnet)
    .add_input(utxo)
    .amount(Amount::from_kvnc(1))
    .set_fee(Amount::from_atoms(10_000))
    .set_change(owner.address())
    .build()?;                                       // locks to vault.address() (0x05)
```

Multisig M-of-N, offline signing shares assembled client-side:

```rust
let script = MultisigScript::new(2, vec![pk1, pk2, pk3])?;  // 2-of-3
let mut signer = MultisigSigner::new(tx);               // unsigned tx
// each cosigner signs the same sighash independently:
let sig1 = signer.sign_share(&keypair1);                // offline
let sig2 = signer.sign_share(&keypair2);
signer.attach_witness(&script, &[sig1, sig2])?;         // [script, sig1, sig2]
let signed_tx = signer.tx;                              // public field; submit via submit_tx
```

Every script exposes the convenience `script.address()` (P2SH 0x01, HTLC 0x04,
vault 0x05) — no manual hashing needed.

## 7. Wiring a real node

```bash
# participant node (no mining, no faucet, no operator role)
# [CURRENT] pre-transition. KOVANICA_POW / KOVANICA_MINE are [TARGET]-for-removal.
export KOVANICA_POW=1 KOVANICA_MINE=0 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0 KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000
export KOVANICA_DATA="$PWD/data"
./target/release/kovanica-node explorer 127.0.0.1:8080

# [TARGET] post-transition equivalent — plain participant, no consensus role
export KOVANICA_CONSENSUS=poa KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0 KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000
export KOVANICA_DATA="$PWD/data"
```

Point the SDK at it: `Client::new("http://127.0.0.1:8080")`. Live tests:
`KOVANICA_API=http://127.0.0.1:8080 cargo test -p kovanica-rpc --features live-testnet`.

P2P seed policy: `seed.kovanica.online:9000` / `seed2.kovanica.online:9000`
(TCP 9000 only). Never dial `explorer.kovanica.online:9000` — it is
orange-cloud and proxies TCP.

## 8. Browser (WASM) flow

The wasm binding builds and signs transfers in-page; the key never leaves the
caller.

```js
import { build_signed_transfer } from '@kovanica/sdk-wasm';

// 1. UTXOs come from GET /api/utxos (typed rows in the Rust client).
// 2. Build + sign locally. Amounts are decimal strings — JS numbers lose
//    integer precision above 2^53, and Kovanica atoms reach ~9e15.
const { tx_hex, sighash } = build_signed_transfer(
  phrase,            // the backup phrase (string)
  0,                 // SLIP-0010 index, frozen path m/44'/3007'/0'/0'/i'
  'testnet',
  JSON.stringify(utxos),   // [{tx_hash, vout, amount_atoms, asset_hex}]
  JSON.stringify(outputs), // [{address, amount_atoms, asset_hex}]
  '2000',            // era-0 floor, atoms/byte; derive live from /api/bootstrap
  changeAddress,     // kvnc…dag; empty string = no change output
);
// 3. Broadcast the signed hex; the node never sees the key.
await fetch(`${api}/api/submit_tx`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ tx_hex }),
});
```

`NULL` asset ids map to native KVNC; any other 64-hex id is a KVP-102 asset.
The frozen path, address codec and sighash are byte-identical with the node —
verified by shared vectors on both sides.

## 9. Safety checklist

- Keys/mnemonics stay client-side; `POST /api/submit_tx` only gets `tx_hex`.
- Never reuse demo keys; zeroize key material on drop (SDK zeroizes on drop).
- Coinbase outputs: 100-block maturity (RFC-006). Fee: 75% burned / 25% to
  producer — plan fees with `kovanica-fee`.
- Hard cap: 90.2M KVNC; `native_minted ≤ max_supply` is enforced by consensus
  and asserted by the live suite.
- Never point public nodes at `KOVANICA_ALLOW_RESET=1` or an open faucet.
- Numbers in this cookbook assume era 0 (subsidy 10 KVNC); derive live values
  from `/api/bootstrap` when era changes (every 2M blocks, ×¾ decay).