# Light-Node / SPV Path for Hybrid PoW/PoS + VRF

Goal: allow a resource-constrained client (mobile UniFFI light-node, browser extension, hardware-wallet companion) to:

1. Follow the **selected chain** with high confidence.
2. Verify that recent staked blocks were legitimately eligible (VRF).
3. Obtain a usable finality signal (blue-score depth).
4. (Later) verify transaction inclusion without a full UTXO set.

This document specifies the minimal data and verification steps the light-node needs from the hybrid consensus defined in RFC-008.

---

## 1. Threat model & security assumptions

- Light-node trusts the **cryptographic primitives** (Ed25519, VRF, hash).
- Light-node does **not** download the full anticone or the full UTXO set.
- Long-range / history-rewrite attacks are mitigated by:
  - Weak subjectivity (recent checkpoint from a trusted source or social consensus), **or**
  - A known genesis + continuous header chain from a point the user has already accepted.
- Finality is probabilistic and expressed in **blue-score advance**, not wall-clock time or raw height (same recommendation as pure GHOSTDAG notes).

---

## 2. Data the light-node must obtain

### 2.1 Selected-chain headers

A sequence of headers linked by `selected_parent` (or an equivalent compact proof of the selected path). Each header contains at least:

- Parent hash(es) / selected-parent pointer
- Blue-score (or enough information to recompute it along the selected path)
- Timestamp, version
- For staked headers: `StakeProof` (pubkey, VRF proof, slot)
- Optional future fields: `utxo_commitment`, `stake_root`

### 2.2 Auxiliary data (minimal)

- Current consensus parameters (`SLOT_LENGTH`, `FIXED_STAKE_WORK`, `THRESHOLD`, …) — can be hardcoded per network version or fetched from a trusted bootstrap.
- (Optional) Recent stake-root or total-active-stake snapshots if the light-node wants to re-verify eligibility without trusting the full node.

### 2.3 What the light-node does **not** need for basic tip following

- Full DAG / anticone
- Full transaction bodies (unless verifying a specific payment)
- Complete UTXO set

---

## 3. Verification algorithm (tip following)

```text
function verify_selected_chain(headers: [Header], checkpoint: Header) -> Result<Tip> {
    assert headers[0] links to checkpoint (or is the checkpoint)
    let mut prev = checkpoint
    for h in headers {
        // 1. Structural
        assert h.selected_parent == prev.hash
        assert h.version >= HYBRID_VERSION or (no StakeProof present)

        // 2. Work / score
        let work = if h.has_stake_proof() {
            verify_vrf_and_eligibility(h, prev)?;
            FIXED_STAKE_WORK
        } else {
            // PoW: light-node may skip full PoW verification
            // or verify against a known target if it has the bits
            h.claimed_pow_work   // or recompute if desired
        }
        // Blue-score must be consistent with GHOSTDAG rules on the
        // selected path (simplified check for light clients)
        assert h.blue_score == prev.blue_score + f(work)  // exact formula per impl

        prev = h
    }
    Ok(prev)
}
```

### 3.1 VRF eligibility check on light-node

```text
function verify_vrf_and_eligibility(h: Header, parent: Header) -> Result<()> {
    let slot = parent.blue_score / SLOT_LENGTH
    let seed = H("KovanicaVRF" || parent.hash || epoch_rand)
    let out  = VRF_verify(h.stake_pubkey, seed || slot, h.vrf_proof)?
    // For full eligibility the light-node needs total_active_stake
    // and the validator’s stake weight at parent.
    // Options:
    //   a) Trust a stake root / total committed in parent header
    //   b) Receive a short stake proof (Merkle) from a full node
    //   c) For v1: only verify the VRF proof itself and treat
    //      eligibility as “claimed”; full nodes still enforce it.
    // Recommendation: start with (c) + trusted stake snapshots,
    // move to (a)/(b) once stake_root is in headers.
}
```

---

## 4. Finality signal for wallets

Do **not** expose raw block height as “confirmations”.

Recommended UX:

- “Blue-score depth: X”
- “Selected-chain depth: Y blocks”
- Colour / label changes at thresholds that correspond to several k-windows (k=3).

Example thresholds (tune on testnet):

| Depth (blue-score) | Label          |
|--------------------|----------------|
| < 30               | Pending        |
| 30–100             | Confirmed      |
| > 100              | Final (local)  |

Light-node can compute this solely from the header chain it has verified.

---

## 5. Transaction inclusion (future SPV)

Once headers optionally carry an `utxo_commitment` or transaction Merkle root:

1. Light-node obtains a Merkle (or sparse-Merkle) proof from any full node.
2. Verifies the proof against the commitment in a header that is already deep in the selected chain.
3. Combines with the normal signature / script checks (client-side).

This is deliberately left as a later extension; RFC-008 only requires the header fields to be *ready* for it.

---

## 6. Bootstrap & weak subjectivity

- Ship a recent trusted checkpoint (hash + blue-score + stake snapshot) with the light-node binary or fetch it over HTTPS from a known domain (explorer / docs).
- After the checkpoint, continuous header sync is sufficient.
- Document clearly that going back before the checkpoint without additional trust assumptions is unsafe (classic PoS light-client limitation).

---

## 7. UniFFI / mobile considerations

- Keep the verification path pure-Rust, no async networking inside the core verify functions.
- Expose:
  - `verify_header_chain(checkpoint, headers) -> TipInfo`
  - `verify_stake_proof(header, parent, stake_context) -> bool`
  - `blue_score_depth(tip, target) -> u64`
- Networking (header download, proof download) stays in the host app (Kotlin/Swift/JS).

---

## 8. Interaction with full-node API

Useful endpoints (to be added or extended):

- `GET /api/headers?from=<hash>&count=N` — selected-chain headers
- `GET /api/header/<hash>` — single header + optional proofs
- `GET /api/stake-snapshot?at=<hash>` — total + per-validator (or root)
- Existing `/api/head` already returns tip; extend with `blue_score`, `consensus_version`, `hybrid_active: bool`

---

## 9. Testing checklist for light-node

- [ ] Verify pure-PoW selected chain
- [ ] Verify mixed chain containing staked headers
- [ ] Reject header with invalid VRF proof
- [ ] Reject header whose slot does not match parent blue-score
- [ ] Correct blue-score depth calculation
- [ ] Behaviour across activation height (pre/post hybrid)
- [ ] Checkpoint + incremental sync
- [ ] Memory / CPU budget on mid-range mobile

---

## 10. Summary of consensus requirements on headers

For the light-node path to work cleanly, RFC-008 / implementation must guarantee:

1. Staked headers carry a self-contained, verifiable VRF proof.
2. Slot is a pure function of the selected parent’s blue-score.
3. Blue-score (or the data needed to recompute it along the selected path) is present or easily derived.
4. Optional but strongly recommended: stake root or total-active-stake commitment for full eligibility checks without trusting a server.

---

**Status:** Design companion to RFC-008. Implement in parallel with the full-node admission path so that light-node and full-node stay in sync from day one of the hybrid fork.
