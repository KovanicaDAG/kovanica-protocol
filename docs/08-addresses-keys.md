# 08 — Addresses & Keys

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

## 1. Key type

Kovanica uses **Ed25519** keys. A public key is 32 raw bytes; a signature is 64
bytes. Addresses are derived from the Ed25519 public key — the raw 32-byte
public key is the address payload (`address.payload_bytes`).

## 2. Canonical address form

An address renders as:

```
kvnc<64-hex>dag
```

where `<64-hex>` is `address.payload_bytes` bytes (the public key) followed by
`address.checksum_bytes` of a BLAKE3-based checksum. Prefix and suffix are
`address.prefix` and `address.suffix`.

Per-chain address formats are `pending`: today chain 4 uses the form above; a
decision on whether chain 1 only uses `kvnc…dag` is pending.

## 3. Signing domains

Signatures are domain-separated. The relevant domain tags are published as
`wire.*` parameters:

| Purpose | Domain |
|---------|--------|
| Votes | `wire.vote_domain` |
| Transactions | `wire.tx_domain` |
| Commit seals | `wire.commit_domain` |
| Light VRF | `wire.light_vrf_domain` |

Vote signature bytes commit to `(chain_id, epoch, voter, leader_round,
leader_hash)` and are `wire.vote_signature_len` bytes long.

Transactions sign a preimage of
`tx_domain || chain_id || sender || nonce || kind || fee`. The transaction
`epoch` is **not** part of the signed hash.

Commit seals sign
`commit_domain || chain_id || leader_header_hash`.

## 4. Keyed-hash domain keys

Independent of the ASCII signing domains, some hashes use BLAKE3 keyed-hash
domain keys (for example `wire.tx_hash_domain_key`). A migration from legacy
`KVNC-*` keys to `KUNA-*` keys is in progress and is `pending`; the published
key is a `pending` value.

## 5. Chain IDs

Each network has a `chain_id` (`chain.*` in the parameter file). A signature
made for one chain or epoch never verifies on another. Chain identity is
included in every signing domain.

## 6. Key handling

Private keys and seeds are **client-side only**. A node never receives them.
The standard transaction flow is: prepare the payload, sign offline with the
private key, then submit the signed transaction.
