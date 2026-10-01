# Quantum Resistance — Research & Upgrade Path

Status: **Research** · Last updated: 2026-09-29

## Current cryptographic primitives

| Primitive | Usage | Quantum vulnerability |
|-----------|-------|----------------------|
| Ed25519 | Signatures (tx, block, authority) | **Vulnerable** — Shor's algorithm breaks ECDSA/Ed25519 in polynomial time |
| BLAKE3 | Hashing (txid, block hash, asset ID) | **Resistant** — Grover's algorithm only halves security (256-bit → 128-bit) |
| SHA-256 | Hashing (auxiliary) | **Resistant** — same as BLAKE3 |
| HMAC-SHA512 | Key derivation (SLIP-10) | **Resistant** — same as SHA-256 |
| X25519 | Key exchange (chat) | **Vulnerable** — same as Ed25519 |

## Threat model

A cryptographically relevant quantum computer (CRQC) can:
1. **Forge signatures** — derive private keys from public keys (Shor's algorithm)
2. **Break key exchange** — derive shared secrets (Shor's algorithm)

Hashing (BLAKE3, SHA-2) is **not** threatened by quantum computing in the same way — Grover's algorithm only provides a quadratic speedup, which is mitigated by using 256-bit hashes.

## Upgrade path

### Phase 1: Hybrid signatures (recommended)

Add a post-quantum signature scheme alongside Ed25519:

| Scheme | Type | Signature size | Public key size | Security |
|--------|------|---------------|-----------------|----------|
| CRYSTALS-Dilithium (FIPS 204) | Lattice | ~2.4 KB | ~1.3 KB | NIST Level 3 |
| SPHINCS+ | Hash-based | ~8 KB | ~32 bytes | NIST Level 3 |
| Falcon | Lattice | ~0.7 KB | ~0.9 KB | NIST Level 3 |

**Recommended: CRYSTALS-Dilithium** (or FIPS 204 final) for primary use, with SPHINCS+ as fallback.

### Phase 2: Address migration

1. New addresses include both Ed25519 and Dilithium public keys
2. Transactions are signed with both schemes
3. Old Ed25519-only addresses remain valid but are marked "legacy"
4. Users are encouraged to migrate to hybrid addresses

### Phase 3: Full transition

1. Ed25519 signatures are rejected for new transactions
2. Only hybrid or Dilithium-only signatures are accepted
3. Old addresses can still be spent (with Dilithium signature)

## Implementation plan

### Step 1: Research (now)

- [ ] Evaluate Rust PQ crypto libraries:
  - `pqcrypto` — NIST PQC reference implementations
  - `dilithium` — CRYSTALS-Dilithium
  - `sphincsplus` — SPHINCS+
- [ ] Benchmark signature/verification times
- [ ] Assess impact on block size and throughput

### Step 2: Prototype (Q1 2027)

- [ ] Add `kovanica-pq` crate with Dilithium support
- [ ] Implement hybrid address format
- [ ] Write tests for hybrid signing/verification

### Step 3: Integration (Q2 2027)

- [ ] Add hybrid signature support to `kovanica-state`
- [ ] Update transaction format to include optional PQ signature
- [ ] Update validation logic

### Step 4: Migration (Q3 2027)

- [ ] Deploy hybrid address support on testnet
- [ ] Provide migration tool for existing addresses
- [ ] Monitor adoption

### Step 5: Full transition (Q4 2027+)

- [ ] Reject Ed25519-only signatures on mainnet
- [ ] Only accept hybrid or PQ-only signatures

## Libraries

| Library | Language | Schemes | Status |
|---------|----------|---------|--------|
| `pqcrypto` | Rust | Dilithium, SPHINCS+, Falcon, Kyber | Active |
| `liboqs` | C | All NIST PQC | Active |
| `pqclean` | C | All NIST PQC | Active |
| `dilithium` | Rust | CRYSTALS-Dilithium | Active |

## References

- [NIST PQC Standardization](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [FIPS 204 (Dilithium)](https://csrc.nist.gov/pubs/fips/204/final)
- [FIPS 205 (SPHINCS+)](https://csrc.nist.gov/pubs/fips/205/final)
- [RFC 9370 — PQ in TLS](https://datatracker.ietf.org/doc/rfc9370/)

## Notes

- This is a **long-term** research item. No immediate action required.
- The current Ed25519 signatures are secure against classical computers.
- Quantum computers capable of breaking Ed25519 are estimated to be 10-30 years away.
- The upgrade path is designed to be **backward-compatible** — old addresses remain valid.
- Hashing (BLAKE3, SHA-2) is already quantum-resistant for practical purposes.
