# 08 — Addresses & Keys

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

## 1. Key type

Kovanica uses **Ed25519** keys. A public key is 32 raw bytes; a signature is 64
bytes. Addresses are derived from the Ed25519 public key — the raw 32-byte
public key is the address payload (`address.payload_bytes`).

## 2. Canonical address form (PRO-21)

A canonical Kovanica address is **64 characters** long (PRO-21, locked in AGENTS.md):

```
kvnc<57-base32>dag
```

where:
- `address.prefix` is `"kvnc"` (4 chars).
- `<57-base32>` is 57 lowercase characters using the standard bech32 alphabet (`qpzry9x8gf2tvdw0s3jn54khce6mua7l`), encoding 285 bits: the 32-byte (256-bit) public key concatenated with the first 29 bits of `blake3(key)` (256 + 29 = 285 bits = 57 × 5 bits, exact, zero padding).
- `address.suffix` is `"dag"` (3 chars).

### Known Answer Tests (KATs)

Canonical KATs implemented in `kovanica-types`:
- **Zero key** (`[0u8; 32]`):
  `kvncqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz4k5rcdag`
- **Sample key** (`[1, 2, ..., 32]`):
  `kvncqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc07228f2dag`

### Per-chain acceptance rules

- Canonical base32 is standard on every chain, and `FromStr` strictly parses base32.
- Legacy forms (`kvnc<64-hex>dag` and raw `0x` hex) are accepted via `parse_for_chain` only on testnet/dev chains (chains 4, 3, 1337).
- Mainnet (chain 1) and all other chain IDs strictly reject legacy hex forms.

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
