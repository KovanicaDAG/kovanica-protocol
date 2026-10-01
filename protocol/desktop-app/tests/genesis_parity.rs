//! Offline genesis-parity regression suite (Slice A gate).
//!
//! Fixtures captured from the **live network on 2026-09-27** (post-PoA reset):
//! - `GET https://explorer.kovanica.online/api/bootstrap` → genesis, network
//! - `GET https://explorer.kovanica.online/api/head` → genesis, blocks,
//!   `authority_set`, `slot_duration_ms`
//!
//! **RFC-006 is LIVE on testnet** (activated 2026-09-20 as a consensus fork
//! that wiped all pre-RFC-006 balances), and **PoA is now the only admission
//! regime** (RFC-POA-Migration §0, ratified 2026-09-25; the mandatory reset
//! in §6 followed). The live chain runs the RFC-006-era parameters — `k:3`,
//! subsidy `10 * ATOM` (10 KVNC/block), premine `200_000 * ATOM`
//! (200,000 KVNC = 0.2M KVNC), founder seed 1, treasury `10 × 1M KVNC`
//! vaults, `finality_depth 100`, `payload_pruning_depth 1000` — booted through
//! `Node::genesis_with_poa` with the 3-key TESTNET-ONLY placeholder authority
//! set at threshold 2 and 3000 ms slots. Under PoA the genesis coinbase tag is
//! `KVA1 || authority_set_hash`, so the genesis id **commits to the authority
//! set**.
//!
//! Because that id is a commitment to the authority set,
//! `local_genesis_matches_live_network` passing is itself the proof that the
//! set is the live one — a different set derives a different genesis. The
//! authority-set test below therefore asserts the RFC-POA §1 *invariants*
//! rather than re-pinning the key list.
//!
//! Both earlier ids are **obsolete** (each was a deliberate chain reset):
//! - RFC-006-era but pre-PoA (`admission: pow`), coinbase tag `b"genesis"`.
//! - pre-RFC-006-era, subsidy 200 KVNC, premine 200 KVNC, no treasury.
//!
//! Refresh this fixture only on a deliberate network reset, together with
//! `NetworkProfile::testnet()` and `examples/probe_genesis.rs`. See
//! `examples/genesis_parity_live.rs` for the live, network-dependent check.

use kovanica_desktop::profile::{
    NetworkProfile, ATOM, NETWORK_TESTNET, TESTNET_AUTHORITY_KEYS, TESTNET_AUTHORITY_THRESHOLD,
    TESTNET_BLOCK_PRUNING_DEPTH, TESTNET_FINALITY_DEPTH, TESTNET_LIVE_PREMINE,
    TESTNET_LIVE_SUBSIDY, TESTNET_OPERATOR_SEED, TESTNET_PAYLOAD_PRUNING_DEPTH,
    TESTNET_SLOT_DURATION_MS,
};
use kovanica_desktop::service::NodeService;

/// Live testnet genesis id, reported by `/api/bootstrap` + `/api/head`
/// (captured 2026-09-27, post-PoA reset). The embedded node must reproduce
/// this exactly. Under PoA the genesis id commits to the authority set, so
/// this constant pins that set as well.
const LIVE_GENESIS: &str = "08fa538f2e5963bebcf202bee37075bb6b7cf3d0934598888127a20c0a952b4b";

/// Live chain facts used by the gate (captured 2026-09-27, post-PoA reset).
const LIVE_NETWORK: &str = NETWORK_TESTNET;
const LIVE_K: u16 = 3;
const LIVE_SUBSIDY_ATOMS: u64 = 10 * ATOM; // 10 KVNC/block — live /api/head (RFC-006)
const LIVE_PREMINE_ATOMS: u64 = 200_000 * ATOM; // 200,000 KVNC — RFC-006 genesis coinbase
const LIVE_FOUNDER_SEED: u64 = 1;
const LIVE_FINALITY_DEPTH: u64 = TESTNET_FINALITY_DEPTH;
const LIVE_PAYLOAD_PRUNING_DEPTH: u64 = TESTNET_PAYLOAD_PRUNING_DEPTH;
const LIVE_BLOCK_PRUNING_DEPTH: u64 = TESTNET_BLOCK_PRUNING_DEPTH;
const LIVE_SLOT_DURATION_MS: u64 = TESTNET_SLOT_DURATION_MS;
const LIVE_AUTHORITY_COUNT: usize = TESTNET_AUTHORITY_KEYS.len();
const LIVE_AUTHORITY_THRESHOLD: usize = TESTNET_AUTHORITY_THRESHOLD;

#[test]
fn local_genesis_matches_live_network() {
    let mut service = NodeService::new(NetworkProfile::testnet());
    service
        .verify_genesis_parity(LIVE_GENESIS)
        .expect("embedded node must reproduce the live testnet genesis id");
    assert_eq!(service.profile().id, LIVE_NETWORK);
}

#[test]
fn testnet_profile_matches_the_verified_live_chain() {
    // The construction `examples/probe_genesis.rs` proved reproduces the live
    // genesis byte-for-byte. Keep it pinned; both the pre-RFC-006-era schedule
    // and the pre-PoA coinbase tag are obsolete — each was a chain reset.
    let live = NetworkProfile {
        id: LIVE_NETWORK,
        genesis_k: LIVE_K,
        genesis_subsidy: LIVE_SUBSIDY_ATOMS,
        genesis_premine: LIVE_PREMINE_ATOMS,
        founder_seed: LIVE_FOUNDER_SEED,
        finality_depth: LIVE_FINALITY_DEPTH,
        payload_pruning_depth: LIVE_PAYLOAD_PRUNING_DEPTH,
        block_pruning_depth: LIVE_BLOCK_PRUNING_DEPTH,
        operator_seed: TESTNET_OPERATOR_SEED,
        authority_keys: &TESTNET_AUTHORITY_KEYS,
        authority_threshold: LIVE_AUTHORITY_THRESHOLD,
        slot_duration_ms: LIVE_SLOT_DURATION_MS,
        dormant: false,
    };
    assert_eq!(
        NetworkProfile::testnet(),
        live,
        "testnet profile drifted from the verified live chain"
    );
}

#[test]
fn authority_set_satisfies_the_rfcp01_invariants() {
    // The genesis id commits to this set, so a passing
    // `local_genesis_matches_live_network` already proves it is the *live* set.
    // What this guards is the invariant envelope: RFC-POA §1 requires 3-16
    // distinct keys held in canonical (ascending) order, with `2 <= threshold
    // <= n`. A drift in the placeholder base would still build a *valid* set
    // — it would just be the wrong one, which the parity test catches.
    let set = NetworkProfile::testnet()
        .authority_set()
        .expect("testnet authority set must satisfy the RFC-POA §1 invariants");
    assert_eq!(set.len(), LIVE_AUTHORITY_COUNT);
    assert_eq!(set.threshold(), LIVE_AUTHORITY_THRESHOLD);
    assert!(
        (2..=set.len()).contains(&set.threshold()),
        "threshold must satisfy 2 <= t <= n"
    );

    // Canonical order: ascending 32-byte encodings, all keys distinct.
    let encoded: Vec<[u8; 32]> = set.authorities().iter().map(|pk| pk.to_bytes()).collect();
    let mut sorted = encoded.clone();
    sorted.sort();
    assert_eq!(encoded, sorted, "authority keys must be canonically ordered");
    sorted.dedup();
    assert_eq!(sorted.len(), encoded.len(), "authority keys must be distinct");
}

#[test]
fn live_subsidy_and_premine_are_the_rfc006_values() {
    // Guards against a well-meaning "downgrade" to the old pre-RFC-006-era constants
    // (200 KVNC / 200 KVNC), which the probe shows does NOT reproduce the live
    // genesis. If this fails, the network was reset to old-era parameters:
    // update `NetworkProfile::testnet()`, this fixture and
    // `examples/probe_genesis.rs` together — never one alone.
    assert_eq!(TESTNET_LIVE_SUBSIDY, 10 * ATOM);
    assert_eq!(TESTNET_LIVE_PREMINE, 200_000 * ATOM);
    assert_ne!(NetworkProfile::testnet().genesis_subsidy, 200 * ATOM);
    assert_ne!(NetworkProfile::testnet().genesis_premine, 200 * ATOM);
}

#[test]
fn atom_and_kvnc_units_match_live_reports() {
    // /api/bootstrap and /api/head both report atom = 100_000_000.
    assert_eq!(ATOM, 100_000_000);
}

#[test]
fn boot_reports_genesis_and_founder() {
    let mut service = NodeService::new(NetworkProfile::testnet());
    let (genesis, founder) = service.boot().expect("testnet must boot");
    assert_eq!(genesis, LIVE_GENESIS);
    // Founder is actor seed 1 (deterministic keys).
    let expected_founder = kovanica_node::Node::address(LIVE_FOUNDER_SEED).to_string();
    assert_eq!(founder, expected_founder);
    assert_eq!(service.block_count(), 1); // genesis only
    assert!(service.selected_tip().is_some());
}

#[test]
fn dormant_mainnet_refuses_to_boot() {
    let mut service = NodeService::new(NetworkProfile::mainnet());
    let err = service
        .boot()
        .expect_err("dormant profiles must refuse to boot");
    assert!(
        matches!(err, kovanica_desktop::BootError::DormantNetwork(_)),
        "expected DormantNetwork, got {err}"
    );
}

#[test]
fn parity_rejects_a_wrong_genesis() {
    let mut service = NodeService::new(NetworkProfile::testnet());
    let err = service
        .verify_genesis_parity("0000000000000000000000000000000000000000000000000000000000000000")
        .expect_err("a mismatched live genesis must fail the gate");
    assert!(
        matches!(err, kovanica_desktop::ParityError::Mismatch { .. }),
        "expected Mismatch, got {err}"
    );
}
