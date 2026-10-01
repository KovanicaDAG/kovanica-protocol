# Kovanica Address Format

> **One-line summary:** Specification for the `kvnc...dag` address format, version bytes, encoding, and parsing rules.
>
> **Status:** Draft
>
> **Consensus impact:** ledger-safe (address parsing/rendering only)

---

## 1. Overview

All Kovanica addresses share a common rendering: **`kvnc...dag`** (base58 over versioned bytes). The version byte discriminates the address type at parse time.

| Version | Name | Payload | On-Chain Size | Rendering |
|---------|------|---------|---------------|-----------|
| `0x00` | P2PK (Single-key) | 32-byte Ed25519 public key | 33 bytes | `kvnc...dag` |
| `0x01` | P2SH (Multisig) | BLAKE3(redeem_script) | 33 bytes | `kvnc...dag` |
| `0x02` | Script v2 | BLAKE3(script_bytes) | 33 bytes | `kvnc...dag` |
| `0x03` | Stealth (on-chain) | BLAKE3(scan_pk \|\| spend_pk) | 33 bytes | `kvnc...dag` |
| `0x03` | Stealth (published) | scan_pk \|\| spend_pk (65 bytes) | 65 bytes | `kvnc...dag` (over 65 bytes) |
| `0x04` | HTLC | BLAKE3(template) | 33 bytes | `kvnc...dag` |
| `0x05` | Vault | BLAKE3(template) | 33 bytes | `kvnc...dag` |

> **Note:** All non-P2PK addresses share the same `kvnc...dag` rendering shape. The version byte discriminates the type.

---

## 2. Binary Format

### 2.1 Standard Addresses (33 bytes)
```
[version: 1 byte] [payload: 32 bytes]
```

### 2.2 Stealth Published Address (65 bytes)
```
[0x03] [scan_pk: 32 bytes] [spend_pk: 32 bytes]
```
This form is **never stored on-chain** — only shared off-chain with senders.

---

## 3. Encoding (Base58)

The `kvnc...dag` rendering uses Bitcoin-style base58 with a custom alphabet.

```
address_bytes = version_byte || payload
checksum = first 4 bytes of BLAKE3(BLAKE3(address_bytes))
encoded = base58(address_bytes || checksum)
rendered = "kvnc" + encoded + "dag"
```

### 3.1 Parsing
`Address::parse(input)` accepts:
- `kvnc...dag` (base58, full form)
- 66-hex (33 bytes = version + 32-byte payload)
- 64-hex (legacy P2PK, treated as version 0x00 + 32-byte pk)
- 130-hex (65 bytes = stealth published address)

---

## 4. Address Types Detail

### 4.1 P2PK (0x00) — Single-Key
- **Payload:** 32-byte Ed25519 public key
- **Derivation:** `Address::p2pk(pk)` or `KeyPair::address()`
- **Spend:** Single 64-byte Ed25519 signature over sighash

### 4.2 P2SH (0x01) — Multisig (RFC-001)
- **Payload:** BLAKE3(redeem_script)
- **Redeem script:** `[M (1B), N (1B), pk1 (32B), ..., pkN (32B)]`
- **Constraints:** `1 <= M <= N <= 16`
- **Spend:** Witness = `[redeem_script, sig1, ..., sigM]` (exactly M signatures)

### 4.3 Script v2 (0x02) — Bounded Script (RFC-003)
- **Payload:** BLAKE3(script_bytes)
- **Script format:** Bytecode with opcodes 0x01-0x08 (ED25519_VERIFY, CLTV, CSV, HASH_BLAKE3, EQUAL, AND, OR, THRESHOLD)
- **Max length:** 1024 bytes
- **Step budget:** 1000
- **Spend:** Witness = `[script_bytes, stack_elements...]`

### 4.4 Stealth (0x03) — One-Time Keys (RFC-003)
- **Published (off-chain):** `0x03 || scan_pk || spend_pk` (65 bytes)
- **On-chain (stored):** `0x03 || BLAKE3(scan_pk || spend_pk)` (33 bytes)
- **Output extension:** `StealthExt { r: 32B, view_tag: 1B, p: 32B }` (65 bytes)
- **Derivation (sender):** `R = r·G`, `view_tag = BLAKE3(r·scan_pk)[0]`, `P = H(r·spend_pk)·G`
- **Spend:** Single 64-byte signature over sighash, verified against `P` (one-time pubkey)

### 4.5 HTLC (0x04) — Hash Time-Locked Contract (RFC-004)
- **Payload:** BLAKE3(template)
- **Template (100 bytes):** `preimage_hash (32B) || recipient_pk (32B) || sender_pk (32B) || timeout (4B LE)`
- **Spend paths:**
  - Redeem (3 witness elements): `[template, preimage, recipient_sig]`
  - Refund (2 witness elements): `[template, sender_sig]` + `height >= timeout`

### 4.6 Vault (0x05) — Time-Lock Vault (RFC-005)
- **Payload:** BLAKE3(template)
- **Template (40 bytes):** `unlock_height (4B LE) || csv (4B LE) || owner_pk (32B)`
- **Both locks required:** `height >= unlock_height` AND `height >= creation_height + csv`
- **Spend:** Witness = `[template, owner_sig]`

---

## 5. Code Reference

### 5.1 Rust (kovanica-state)
```rust
// Parsing
let addr = Address::parse("kvnc...")?;
let addr = Address::parse("66-hex")?;
let addr = Address::parse("64-hex")?; // legacy P2PK

// Construction
let addr = Address::p2pk(pk);
let addr = Address::p2sh(script_hash);
let addr = Address::script_v2(script_bytes);
let addr = Address::stealth(scan_pk, spend_pk); // on-chain form
let addr = Address::htlc(template_hash);
let addr = Address::vault(template_hash);

// Rendering
let rendered = addr.to_kvnc(); // "kvnc...dag"
let hex = addr.to_hex();       // 66-hex (or 130-hex for stealth published)

// Predicates
addr.is_p2pk()
addr.is_p2sh()
addr.is_script_v2()
addr.is_stealth()     // on-chain form
addr.is_htlc()
addr.is_vault()
```

### 5.2 FFI (kovanica-ffi)
- `address_from_hex(hex: String) -> String` (returns kvnc form)
- `address_to_hex(kvnc: String) -> String` (returns hex)
- All wallet methods accept both forms

### 5.3 Web (kovanica-web)
- Wallet UI displays `kvnc...dag`
- Send input accepts `kvnc...dag`, 66-hex, 64-hex
- `parseAddress(input)` in `src/lib/wallet/address.ts`

---

## 6. Version Registry

| Version | RFC/KVP | Activation | Notes |
|---------|---------|------------|-------|
| 0x00 | Genesis | Genesis | P2PK |
| 0x01 | RFC-001 / KVP-101 | Blue score 0 | Multisig |
| 0x02 | RFC-003 / KVP-103 | Blue score 0 | Script v2 |
| 0x03 | RFC-003 / KVP-103 | Blue score 0 | Stealth |
| 0x04 | RFC-004 / KVP-104 | Blue score 0 | HTLC |
| 0x05 | RFC-005 / KVP-105 | Blue score 0 | Vault |

`VERSION_MAX` in `keys.rs` = `0x05` (updated per RFC)

---

## 7. Checkpoint & Wire Notes

- All on-chain addresses are **33 bytes** (version + 32-byte hash/pk)
- Stealth published form (65 bytes) is **off-chain only**
- Transaction encoding writes owner as 33-byte versioned address
- Checkpoint v5+ encodes stealth outputs with flag + 65-byte extension
- No separate address type on wire — version byte discriminates

---

## 8. Related Documents

- [SPEC-INDEX.md](./SPEC-INDEX.md) -- Address version registry table
- [RFC-001-Multisig.md](./RFC-001-Multisig.md) -- P2SH detail
- [RFC-003-ScriptV2-and-Stealth.md](./RFC-003-ScriptV2-and-Stealth.md) -- Script v2 & Stealth detail
- [RFC-004-Htlc.md](./RFC-004-Htlc.md) -- HTLC detail
- [RFC-005-Vault.md](./RFC-005-Vault.md) -- Vault detail
- [TESTNET-GUIDE.md](./TESTNET-GUIDE.md) -- Usage examples

---

*Last updated: 2026-09-21 | Network: kovanica-testnet*
