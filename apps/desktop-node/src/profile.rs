//! Network profiles for the desktop app.
//!
//! Mirrors `NetworkProfile` in `crates/kovanica-node/src/explorer.rs` (private
//! to that crate). These are **consensus genesis parameters**: changing them
//! changes the genesis block id and must never diverge from the network's real
//! parameters without tripping the genesis-parity gate
//! ([`crate::service::NodeService::verify_genesis_parity`]).
//!
//! ## Which parameters are live?
//!
//! **RFC-006 is LIVE on testnet** (activated 2026-09-20 as a consensus fork
//! that wiped all pre-RFC-006 balances). The live testnet now runs the
//! RFC-006-era chain: `k:3`, subsidy `10 * ATOM` (10 KVNC/block), premine
//! `200_000 * ATOM` (200,000 KVNC = 0.2M KVNC), founder seed 1, treasury
//! `10 × 1M KVNC` vaults, `finality_depth 100`, `payload_pruning_depth 1000`.
//!
//! **PoA is the only admission regime** (RFC-POA-Migration §0, ratified
//! 2026-09-25). Since the mandatory PoA reset the live chain is
//! `1a635915…`, built by `Node::genesis_with_poa`. Under PoA the genesis
//! coinbase tag is `KVA1 || authority_set_hash`
//! ([`kovanica_state::poa_genesis_tag`]), so **the genesis id commits to the
//! authority set** — a node configured with a different set derives a
//! different genesis, which is a hard fork marker. This is why the authority
//! set ([`NetworkProfile::authority_set`]) is a consensus genesis parameter
//! here and not local policy, and why [`crate::service::NodeService`] must
//! boot through `genesis_with_poa` rather than the legacy
//! `genesis_with_finality` (which tags the coinbase `b"genesis"` and yields
//! `7c5361da…`, the pre-PoA id).
//!
//! The live testnet authority set is **not** the node crate's deterministic
//! placeholder fallback: it is an explicit 3-key list produced by an authority-
//! key ceremony, at threshold 2 with 3000 ms slots. See
//! [`crate::authority_keys`] — including why the distinction is
//! consensus-critical and why substituting the placeholder set yields a
//! different (still valid) genesis, i.e. a fork.
//!
//! Historical, both **obsolete** (each was a deliberate chain reset):
//! - RFC-006-era, pre-PoA (`admission: pow`), coinbase tag `b"genesis"`.
//! - pre-RFC-006-era, subsidy 200 KVNC, premine 200 KVNC, no treasury.

use kovanica_dag::{AuthorityError, AuthoritySet};
use kovanica_state::{RFC006_GENESIS_SUBSIDY, RFC006_PREMINE};

/// Live testnet network id (`/api/bootstrap → network`).
pub const NETWORK_TESTNET: &str = "kovanica-testnet";
/// Dormant mainnet network id (never booted implicitly).
pub const NETWORK_MAINNET: &str = "kovanica-mainnet";
/// Founder actor seed used by the testnet genesis (deterministic keys).
pub const FOUNDER_SEED: u64 = 1;
/// Finality depth of the live testnet (blocks below this blue score become final).
pub const TESTNET_FINALITY_DEPTH: u64 = 100;
/// Payload pruning depth of the live testnet (below this score payloads are evicted).
pub const TESTNET_PAYLOAD_PRUNING_DEPTH: u64 = 1000;
/// 1 KVNC = 10^8 atoms (same value as `explorer.rs::ATOM`).
pub const ATOM: u64 = 100_000_000;
/// Block pruning depth of the live testnet (blocks this far below the tip are
/// evicted entirely). Mirrors `block_pruning_depth` on `/api/bootstrap`.
pub const TESTNET_BLOCK_PRUNING_DEPTH: u64 = 1000;
/// PoA slot duration of the live testnet (ms) — `/api/head.slot_duration_ms`.
pub const TESTNET_SLOT_DURATION_MS: u64 = 3_000;
/// Re-export of the live testnet PoA authority set (public keys) and its
/// update threshold, for callers that only need the set.
pub use crate::authority_keys::{TESTNET_AUTHORITY_KEYS, TESTNET_AUTHORITY_THRESHOLD};
/// Deterministic testnet operator-wallet seed (`b"OPERATOR_TESTNET_SEED_2026_09_17"`).
///
/// This does **not** affect the genesis id — the operator wallet is not part of
/// the genesis coinbase. It is pinned so the embedded node reports the same
/// `operator_wallet_address` as the live node and does not regenerate a random
/// wallet (and overwrite `operator-wallet.key`) on every boot.
pub const TESTNET_OPERATOR_SEED: [u8; 32] = [
    0x4f, 0x50, 0x45, 0x52, 0x41, 0x54, 0x4f, 0x52, 0x5f, 0x54, 0x45, 0x53, 0x54, 0x4e, 0x45, 0x54,
    0x5f, 0x53, 0x45, 0x45, 0x44, 0x5f, 0x32, 0x30, 0x32, 0x36, 0x5f, 0x30, 0x39, 0x5f, 0x31, 0x37,
];

/// RFC-006 live testnet issuance: 10 KVNC/block (atoms).
///
/// The genesis-parity gate verified this is the *only* value that reproduces
/// the live genesis (see the module docs and `examples/probe_genesis.rs`).
pub const TESTNET_LIVE_SUBSIDY: u64 = 10 * ATOM;
/// RFC-006 live founder premine: 200,000 KVNC (atoms).
///
/// Matches `kovanica-node`'s explorer `GENESIS_PREMINE` (RFC-006 era).
pub const TESTNET_LIVE_PREMINE: u64 = 200_000 * ATOM;

/// A network identity: id, genesis parameters, and data-dir isolation (slice B
/// wires the data dir / `network` marker file enforcement).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NetworkProfile {
    /// Network id — reported by `/api/bootstrap`, `/api/head` and the snapshot.
    pub id: &'static str,
    /// GHOSTDAG `k` parameter for this network's genesis.
    pub genesis_k: u16,
    /// Per-block subsidy cap at genesis (atoms).
    pub genesis_subsidy: u64,
    /// Founder premine minted by the genesis coinbase (atoms).
    pub genesis_premine: u64,
    /// Founder actor seed (deterministic keys).
    pub founder_seed: u64,
    /// Finality depth: blocks more than this many blue score below the tip
    /// become final. `u64::MAX` disables finality pruning.
    pub finality_depth: u64,
    /// Payload pruning depth: blocks more than this many blue score below the
    /// tip have their payloads evicted. `u64::MAX` disables payload pruning.
    pub payload_pruning_depth: u64,
    /// Block pruning depth: blocks more than this many blue score below the tip
    /// are evicted entirely. Policy, not consensus — it does not affect the
    /// genesis id. Invariant: `>= finality_depth` (RFC-008).
    pub block_pruning_depth: u64,
    /// Deterministic operator-wallet seed. Not part of the genesis coinbase, so
    /// it does not affect the genesis id; pinned for reproducibility.
    pub operator_seed: [u8; 32],
    /// This network's PoA authority set (RFC-POA §1) as **public** Ed25519
    /// verifying keys. See [`crate::authority_keys`] for why this is an
    /// explicit list rather than a derived placeholder, and for the
    /// confidentiality note (these are public; signing keys never live here).
    ///
    /// **A consensus genesis parameter, not local policy:** the genesis
    /// coinbase tag is `KVA1 || authority_set_hash`, so a different set
    /// derives a different genesis id — a hard fork.
    pub authority_keys: &'static [[u8; 32]],
    /// Authority update threshold (RFC-POA §1: 2 ≤ t ≤ n). Governs
    /// `AuthorityUpdateTx` validity, not per-block admission.
    pub authority_threshold: usize,
    /// PoA slot duration in milliseconds (RFC-POA §3; live: 3000).
    pub slot_duration_ms: u64,
    /// Dormant placeholder (mainnet): genesis parameters are TBD and the
    /// profile refuses to boot.
    pub dormant: bool,
}

impl NetworkProfile {
    /// This network's PoA authority set (RFC-POA §1).
    ///
    /// The keys are encoded/decoded through `AuthoritySet::from_bytes` —
    /// byte-for-byte the same path the node crate's `poa_config_from_env` uses
    /// for an explicit `KOVANICA_AUTHORITIES` value — so the canonical
    /// ordering and the resulting `hash()` (which the genesis coinbase tag
    /// commits to) are identical to the live node's.
    ///
    /// **This is a consensus genesis parameter, not local policy:** a different
    /// set yields a different genesis id and therefore a hard fork.
    pub fn authority_set(&self) -> Result<AuthoritySet, AuthorityError> {
        // Canonical encoding: threshold u64 LE || count u64 LE || pks.
        let mut bytes = Vec::with_capacity(16 + 32 * self.authority_keys.len());
        bytes.extend_from_slice(&(self.authority_threshold as u64).to_le_bytes());
        bytes.extend_from_slice(&(self.authority_keys.len() as u64).to_le_bytes());
        for pk in self.authority_keys {
            bytes.extend_from_slice(pk);
        }
        AuthoritySet::from_bytes(&bytes)
    }
}

impl NetworkProfile {
    /// The live testnet — the default profile.
    ///
    /// Verified construction (2026-09-27, post-PoA reset): the live network
    /// runs the **RFC-006-era** chain under **PoA-only** admission —
    /// `k:3`, subsidy `10 * ATOM`, premine `200_000 * ATOM`, founder seed 1,
    /// treasury `10 × 1M KVNC` placeholder vaults, `finality_depth 100`,
    /// `payload_pruning_depth 1000`, `block_pruning_depth 1000`, and the
    /// 3-key authority set from [`crate::authority_keys`] at threshold 2 with
    /// 3000 ms slots. Only these values reproduce the live genesis (see
    /// `examples/probe_genesis.rs` and `tests/genesis_parity.rs`).
    pub fn testnet() -> Self {
        Self {
            id: NETWORK_TESTNET,
            genesis_k: 3,
            genesis_subsidy: TESTNET_LIVE_SUBSIDY,
            genesis_premine: TESTNET_LIVE_PREMINE,
            founder_seed: FOUNDER_SEED,
            finality_depth: TESTNET_FINALITY_DEPTH,
            payload_pruning_depth: TESTNET_PAYLOAD_PRUNING_DEPTH,
            block_pruning_depth: TESTNET_BLOCK_PRUNING_DEPTH,
            operator_seed: TESTNET_OPERATOR_SEED,
            authority_keys: &TESTNET_AUTHORITY_KEYS,
            authority_threshold: TESTNET_AUTHORITY_THRESHOLD,
            slot_duration_ms: TESTNET_SLOT_DURATION_MS,
            dormant: false,
        }
    }

    /// Mainnet profile with RFC-006 parameters but still **DORMANT** (mirrors
    /// the explorer's fail-fast guard: mainnet is never activated implicitly).
    ///
    /// Note: the live mainnet treasury keys come from a key ceremony
    /// (`KOVANICA_TREASURY_SEED` in the explorer). Slice B surfaces the
    /// override as an explicit, warned user action — never a default.
    ///
    /// The authority keys below are carried over from testnet only so the
    /// struct is total; they are unreachable because `dormant: true` makes
    /// [`crate::service::NodeService::boot`] fail before any genesis is built.
    /// **Mainnet must never boot on the testnet set** — reusing it would make
    /// mainnet a fork of testnet. Mainnet's real set is still `[OPEN]`
    /// governance input (RFC-POA-Migration §0.7.2) and must arrive from a key
    /// ceremony.
    pub fn mainnet() -> Self {
        Self {
            id: NETWORK_MAINNET,
            genesis_k: 3,
            genesis_subsidy: RFC006_GENESIS_SUBSIDY,
            genesis_premine: RFC006_PREMINE,
            founder_seed: FOUNDER_SEED,
            finality_depth: 1000,
            payload_pruning_depth: 10_000,
            block_pruning_depth: 10_000,
            operator_seed: TESTNET_OPERATOR_SEED,
            authority_keys: &TESTNET_AUTHORITY_KEYS,
            authority_threshold: TESTNET_AUTHORITY_THRESHOLD,
            slot_duration_ms: TESTNET_SLOT_DURATION_MS,
            dormant: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testnet_and_mainnet_ids_are_distinct() {
        assert_ne!(NETWORK_TESTNET, NETWORK_MAINNET);
    }

    #[test]
    fn mainnet_is_dormant_by_default() {
        assert!(NetworkProfile::mainnet().dormant);
        assert!(!NetworkProfile::testnet().dormant);
    }
}
