# RFC-POA-GOVERNANCE — Authority Set Governance (KVP-202)

**Status:** Draft — under reviewer review  
**Consensus impact:** consensus-breaking (sets mainnet genesis authority set parameters; after RFC ratification a genesis reset is required to establish the initial authority set)  
**Related:** KVP-201 (authority set + slot round-robin + authority signature), RFC-001..RFC-006 (all shipped features preserved)  
**Canonical for:** the initial mainnet authority set, key ceremony procedure, threshold, expansion, and recovery — see §0.7.2

---

## One-Line Summary

Settle the 6 open governance inputs that control how the PoA authority set is initially chosen, who can join, how keys are generated and rotated, and what happens when authorities are lost or collude — all using the existing on-chain M-of-N `AuthorityUpdateTx` mechanism (already implemented in `crates/kovanica-dag/src/authority.rs`).

---

## 1. Motivation

The PoA migration (§0) established that block production is now slot-round-robin under a fixed authority set, using Ed25519 signatures (`AuthorityPublicKey = VerifyingKey`). The rotation *mechanism* — M-of-N `AuthorityUpdateTx` — is implemented and ships. The remaining governance decisions that must be settled before the mainnet key ceremony are the 6 inputs below. Without these decisions, the initial authority set parameters are ambiguous and the ceremony cannot proceed to closure.

---

## 2. Constants

| Constant | Value | Source |
|----------|-------|--------|
| `MIN_AUTHORITIES` | `3` | RFC-POA §1; `crates/kovanica-dag/src/authority.rs:34` |
| `MAX_AUTHORITIES` | `16` | RFC-POA §1; `crates/kovanica-dag/src/authority.rs:36` |
| `MIN_THRESHOLD` | `2` | RFC-POA §1; `crates/kovanica-dag/src/authority.rs:38` |
| `DEFAULT_THRESHOLD` | `3` | BFT standard; ceil(2n/3) with n=4 → t=3; chosen by majority of committee |
| `SLOT_DURATION_MS` | `3000` | RFC-POA §3; `crates/kovanica-dag/src/authority.rs:41` |
| `DEFAULT_GENESIS_SUBSIDY` | `10 * ATOM` | RFC-006; `crates/kovanica-state/src/ledger.rs` |
| `MAX_SUPPLY` | `90_200_000 * ATOM` | RFC-006; `crates/kovanica-state/src/ledger.rs` |

---

## 3. Governance Items — Decision Matrix

### Item 1: Initial mainnet authority set selection

How are the launch authorities chosen?

| Option | Description | Consensus impact | Recommended |
|--------|-------------|------------------|-------------|
| **A) Maintainer-appointed** (3–4 keys) | Core team selects and announces the initial set; keys are generated offline. | None (local config → genesis). | **[SELECTED]** — transparent, minimises coordination surface, matches §0.5 social trust model. |
| B) Public ceremony with known entities | Open call for authorities; known entities self-nominate. | Requires on-chain whitelist or off-chain registry. | `[OPEN]` |
| C) Stake-weighted election | Authority weight proportional to native KVNC stake. | Requires hybrid PoW+staked admission — rejected (§0.7.1). | `[TARGET — rejected]` |
| D) Invitation + multi-sig attestation | Core team invites candidates; candidates must produce threshold sigs from existing set. | Minor ceremony extension; no code change. | `[OPEN]` |

**Decision:** **A) Maintainer-appointed** (3–4 keys at launch), expandable toward `n ≤ 16` via `AuthorityUpdateTx`.

---

### Item 2: Eligibility & nomination

Who may operate an authority key?

| Option | Description | Consensus impact | Recommended |
|--------|-------------|------------------|-------------|
| **A) Any Ed25519 key holder** | No eligibility gate beyond having a valid Ed25519 key. | None — purely operational. | `[OPEN]` |
| **B) KYC'd entities only** | Authority operator must pass KYC (off-chain). | Requires on-chain or off-chain KYC registry. | `[OPEN]` |
| **C) Prior testnet operators** | Only operators who participated in testnet genesis are eligible. | Creates a social barrier; no code impact. | `[OPEN]` |
| **D) Mix: core team + invited operators** | Core team (3) + 1–2 invited testnet operators who passed a trial period. | Low ceremony overhead; maintains continuity. | **[SELECTED]** — balances continuity with fresh blood. |

**Decision:** **D) Mix — core team (3) + 1–2 invited testnet operators** who have demonstrated stable node operation.

---

### Item 3: Key ceremony (generation, custody, multi-sig)

How are authority keys generated, distributed, and assembled into the genesis set?

| Option | Description | Consensus impact | Recommended |
|--------|-------------|------------------|-------------|
| **A) `generate_authority_keys` writes 0600 files (PR #53 pattern)** | Key generation script outputs private keys as 0600-protected files; operators load their own key. Private keys never touch the network. Consensus uses only public keys. | None (public keys only on-chain). | **[SELECTED]** — matches existing PR #53 pattern, keys stay client-side per safety rule #4. |
| B) External HSM / hardware signer | Each operator generates keys in an HSM; public keys uploaded to genesis config. | No code change; operational procedure. | `[OPEN]` |
| C) Threshold key generation (FROST) | Joint keygen across operators; no single party ever sees the full private key. | Requires on-chain or off-chain FROST protocol; significant code change. | `[OPEN]` |
| D) Split: generation offline, custody per-operator | Offline generation (e.g., `generate_authority_keys`), then each operator safeguards their share. | Minimal code change; follows existing pattern. | **A + D** — offline generation, per-operator custody, PR #53 pattern. |

**Decision:** **A + D** — offline key generation (PR #53 pattern), per-operator custody of private keys, public keys assembled into genesis config.

**Key ceremony procedure (A + D):**

1. Core team runs `generate_authority_keys` script → outputs 3–4 private key files with mode 0600.
2. Each operator securely receives their private key file; keys never leave their machine.
3. Each operator's public key (`VerifyingKey`) is published to the genesis config (`KOVANICA_AUTHORITIES` env var, comma-separated 64-hex).
4. Genesis set hash = `AuthoritySet::new(public_keys, threshold).hash` → committed in the genesis Authority UTXO.

---

### Item 4: Threshold `t` per set

What is the minimum number of signatures required to admit a block?

| Option | Description | Consensus impact | Recommended |
|--------|-------------|------------------|-------------|
| **A) `t = ceil(2n/3)` (BFT standard)** | For `n` authorities, threshold `t = ceil(2 * n / 3)`. With `n = 4`, `t = 3`. Ensures Byzantine fault tolerance. | Determines quorum size for `AuthorityUpdateTx` validation. | **[SELECTED]** — BFT standard; with `n ≤ 16`, `t ≤ 11`. |
| B) `t = n - 1` (strict majority) | For `n = 4`, `t = 3`. Same as A for n=4; diverges for larger n. | Same validation logic; different quorum. | `[OPEN]` |
| C) `t = n/2 + 1` (simple majority) | For `n = 4`, `t = 3`; for `n = 3`, `t = 2`. | Same validation logic; weaker quorum. | `[OPEN]` |
| D) Configurable per `AuthorityUpdateTx` | Each update carries its own threshold; defaults to A if absent. | Requires on-chain threshold negotiation; adds ceremony complexity. | `[OPEN]` |

**Decision:** **A) `t = ceil(2n/3)` BFT standard** with launch size `n = 4`, `t = 3`. This is the standard BFT threshold and ensures liveness even if 1 authority is offline or malicious.

**Rationale:** With `n = 4` at launch and `t = 3`, the system tolerates 1 absent or malicious authority while maintaining safety. The cap `n ≤ 16` means `t ≤ 11`, keeping the quorum manageable.

---

### Item 5: Expansion from launch toward `n ≤ 16`

How does the authority set grow from its launch size toward the `n ≤ 16` cap?

| Option | Description | Consensus impact | Recommended |
|--------|-------------|------------------|-------------|
| **A) Fixed at launch size (no expansion)** | `n = 4` forever; no mechanism to add new authorities. | None — `AuthorityUpdateTx` still functional but unused for expansion. | `[OPEN]` |
| **B) Add 1 authority per `AuthorityUpdateTx` (slow)** | Each `AuthorityUpdateTx` adds exactly 1 new authority; threshold updates proportionally (`t = ceil(2n/3)`). | Minimal code change; each addition requires `t` signatures from the *current* set. | **[SELECTED]** — conservative, each addition requires threshold quorum. |
| C) Epoch-based expansion (e.g., +2/year) | Authority set grows on a fixed schedule, independent of `AuthorityUpdateTx`. | Requires on-chain epoch timer or off-chain coordination. | `[OPEN]` |
| D) Governance proposal + threshold vote | Any holder can propose expansion; community vote ratifies; threshold updates accordingly. | Requires governance layer beyond `AuthorityUpdateTx`; significant protocol change. | `[OPEN]` |

**Decision:** **B) Add 1 authority per `AuthorityUpdateTx` (slow)** — each addition requires `t` signatures from the current set, maintaining the BFT invariant.

**Expansion procedure (B):**

1. A governance actor proposes an `AuthorityUpdateTx` with 1 new authority public key added to the set.
2. The proposal must carry `≥ t` valid signatures from the *current* authority set over the canonical update payload (`old_set_hash || new_set`).
3. The `AuthorityUpdateTx` is validated and applied: the new set hash becomes live, and `n` increments by 1; `t` recomputes as `ceil(2 * n / 3)`.
4. The process repeats; `n` asymptotically approaches 16.

---

### Item 6: Dissolution / recovery if `t` authorities are lost or collude

What happens if the authority set degrades (e.g., authorities go offline, keys are compromised)?

| Option | Description | Consensus impact | Recommended |
|--------|-------------|------------------|-------------|
| **A) No recovery (current — SPF)** | If `t` authorities are lost, the chain halts. No on-chain recovery mechanism. | Chain halt = final. No code change. | `[OPEN]` |
| **B) Emergency multisig (maintainer keys)** | A separate maintainer multisig can create a new genesis and recover the chain. | Requires maintainer key ceremony; social fork. | `[OPEN]` |
| **C) Social fork + new genesis** | Community coordinates a fork to a new authority set + new genesis. | Full consensus-breaking event; requires broad coordination. | `[OPEN]` |
| **D) Time-locked recovery vault (RFC-005)** | A recovery vault (RFC-005) holds `t`-of-`n` recovery keys; after a time-lock, the set can be updated. | Leverages existing RFC-005 infrastructure; minimal code change. | **[SELECTED]** — recovers using RFC-005 vault mechanism; keys time-locked to prevent immediate abuse. |

**Decision:** **D) Time-locked recovery vault (RFC-005)** — the RFC-005 vault already has `t`-of-`n` recovery infrastructure; extend it to hold authority recovery keys with a time delay (e.g., 30 days) before the set may be updated.

**Recovery procedure (D):**

1. A majority of the current authority set (or the RFC-005 vault custodians) initiates a recovery `AuthorityUpdateTx`.
2. The update carries `≥ t` signatures from the *current* set AND `≥ t` recovery key signatures from the vault.
3. The `AuthorityUpdateTx` is validated normally; additionally, the vault signature check ensures recovery keys are present.
4. After the time-lock period (e.g., 30 days from proposal), the update becomes valid and the new authority set is activated.

---

## 4. On-chain mechanism (already implemented — KVP-201)

The rotation mechanism is the existing `AuthorityUpdateTx`, fully specified in KVP-201 / RFC-POA §1:

- An `AuthorityUpdateTx` spends the current `KVA1` Authority UTXO and creates the next one.
- The transaction must carry `≥ t` distinct valid Ed25519 signatures from members of the *current* authority set.
- The canonical update payload is `old_set_hash || new_set`, where `new_set` is the canonical encoding of the new authority set (sorted keys, threshold).
- The on-chain `Authority UTXO` commits to the set's identity via `BLAKE3(hash)`, so both `hash()` and the slot round-robin are invariant to listing order.

No code changes are needed for the rotation mechanism itself. The 6 governance items above determine *how* and *when* this mechanism is used.

---

## 5. Activation & Genesis Reset Procedure

Once RFC-POA-GOVERNANCE is ratified:

1. **Key ceremony:** Run the offline key generation procedure (Section 3.3) to produce the initial authority set.
2. **Genesis reset:** Execute a mandatory genesis reset (as mandated by RFC-POA-Migration §0.6). The new genesis block commits to the initial `AuthoritySet` hash in its `KVA1` Authority UTXO.
3. **Testnet soak:** Bring up the testnet with the initial authority set; run the 24h multi-validator soak (Gate 2).
4. **Expansion (if desired):** After the soak, if the authority set needs to grow, proceed via `AuthorityUpdateTx` (Item 5, option B).
5. **Mainnet key ceremony:** After testnet validation, repeat the key ceremony for mainnet with the ratified governance parameters.

---

## 6. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Private keys leaving operator devices | Enforce 0600 file output; never transmit private keys over the network. Public keys only are shared for genesis. |
| Threshold `t` too low → safety violation | Use BFT standard `t = ceil(2n/3)`. With `n = 4`, `t = 3`; 1 compromised authority does not break safety. |
| Threshold `t` too high → liveness failure | Model `t = ceil(2n/3)` with `n = 4` → `t = 3`. This tolerates 1 absent/malicious authority while maintaining safety. |
| Ceremony key leakage (PR #53 stdout) | Enforce 0600 file output before ceremony; private keys are destroyed after public key extraction. |
| Governance capture (item 2 eligibility) | Document nomination process transparently; use a mix of core team + invited operators. |
| Recovery vault key leakage (item 6) | Time-locked keys (e.g., 30-day delay) prevent immediate abuse after a breach. |

---

## 7. Test Coverage

After ratification, the following tests should pass:

- **Genesis authority set test:** Verify the genesis `KVA1` Authority UTXO commits to the correct set hash.
- **Authority update test:** Verify `AuthorityUpdateTx` validation with `t` signatures from the current set.
- **Expansion test:** Verify adding 1 authority via `AuthorityUpdateTx` maintains the BFT invariant.
- **Recovery test:** Verify the time-locked recovery vault procedure (Item 6, option D).

---

## 8. References

| Document | Reference |
|----------|-----------|
| RFC-POA-Migration.md | Canonical PoA migration spec (§0.7.2 items 1–6) |
| KVP-201 | Authority set + AuthorityUpdateTx mechanism |
| PR #53 | `generate_authority_keys` pattern (offline, 0600 files) |
| RFC-005 | Time-lock vault (used for recovery in Item 6) |
| AGENTS.md §10 | Security rules — keys never enter node, client-side only |

---

**Next step:** Review and ratification by the governance committee. After ratification, proceed to the key ceremony and genesis reset.