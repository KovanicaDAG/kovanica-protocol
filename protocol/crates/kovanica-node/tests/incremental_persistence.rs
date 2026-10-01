//! Integration tests for C1 incremental persistence.
//!
//! These exercise [`Node::persist_incremental`] and [`Node::load_log`]: a node
//! is rebuilt from its append-only replay log, derived state is recomputed from
//! the records, and the chain can continue afterwards.
//!
//! Every node here is booted under Proof-of-Authority. The `hybrid_log_...`
//! variant that used to assert id stability across a *staked-VRF* replay was
//! converted rather than dropped: id stability across replay is a
//! consensus-critical invariant of any admission scheme, and PoA is the scheme
//! that now enforces it.

use std::fs;

use ed25519_dalek::SigningKey;
use kovanica_dag::{AuthorityPublicKey, AuthoritySet};
use kovanica_node::Node;
use kovanica_state::KeyPair;

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;
/// Authority count for the test set. Threshold is 2-of-3.
const AUTHORITIES: u8 = 3;

/// The test authority set: `AUTHORITIES` keys from seeds `1..=AUTHORITIES`,
/// threshold 2-of-3.
fn authority_set() -> AuthoritySet {
    let keys: Vec<AuthorityPublicKey> = (0..AUTHORITIES)
        .map(|i| SigningKey::from_bytes(&[i + 1; 32]).verifying_key())
        .collect();
    AuthoritySet::new(keys, 2).expect("valid authority set")
}

/// Install every authority signing key so the node can produce in any slot.
fn hold_all_authority_keys(node: &mut Node) {
    for i in 0..AUTHORITIES {
        node.set_authority_signing_key([i + 1; 32]);
    }
}

/// A PoA-booted node holding **every** authority signing key, so it can produce
/// in any slot: round-robin picks the scheduled authority, and
/// `try_produce_poa` matches that key against every key the node holds.
///
/// Pruning is left disabled (`u64::MAX`) so each test can re-apply a specific
/// depth and observe the effect, mirroring `load_or_genesis`.
fn poa_node(subsidy: u64, premine: u64) -> Node {
    let mut node = Node::new();
    node.genesis_with_poa(
        3,
        subsidy,
        premine,
        1,
        None,
        u64::MAX,
        u64::MAX,
        u64::MAX,
        None,
        authority_set(),
        SLOT_MS,
    )
    .expect("genesis");
    hold_all_authority_keys(&mut node);
    node
}

/// Reload from a replay log under the same PoA admission and keys — what
/// `load_or_genesis` does via `restore_poa_policy`. Without this the reloaded
/// node has no admission config and `produce_empty` would fail with
/// `NotAuthoritySlot`.
fn reload_poa(log_path: &str) -> Node {
    let mut node = Node::load_log_with_poa(log_path, authority_set(), SLOT_MS).expect("replay");
    hold_all_authority_keys(&mut node);
    node
}

fn temp_log(name: &str) -> String {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "kovanica-incr-{}-{}-{}",
        name,
        std::process::id(),
        rand::random::<u64>()
    ));
    path.set_extension("log");
    path.to_str().unwrap().to_string()
}

fn remove_log(path: &str) {
    let _ = fs::remove_file(path);
}

#[test]
fn log_roundtrip_recovers_blocks_and_continues() {
    let log_path = temp_log("roundtrip");
    let recipient = KeyPair::from_u64(2);

    // Produce blocks on the original node and persist incrementally.
    let mut node = poa_node(1_000, 1_000);
    node.produce_empty().unwrap();
    node.pool(1, 100, 2).unwrap();
    node.produce_block().unwrap().unwrap();
    let headers_before: Vec<_> = node.export_headers().iter().map(|h| h.id).collect();
    node.persist_incremental(&log_path).unwrap();

    // Rebuild from the log and verify the same non-genesis blocks are present
    // in the same order.
    let mut recovered = reload_poa(&log_path);
    let headers_after: Vec<_> = recovered.export_headers().iter().map(|h| h.id).collect();
    assert_eq!(
        headers_before, headers_after,
        "block ids must match across restart"
    );
    assert_eq!(
        recovered.balance(&recipient.address()).unwrap(),
        100u128,
        "recipient balance must be recovered from replay"
    );

    // The recovered chain must accept new blocks.
    recovered.produce_empty().unwrap();
    assert!(
        recovered.block_count().unwrap() > node.block_count().unwrap(),
        "recovered chain must continue"
    );

    remove_log(&log_path);
}

#[test]
fn loaded_node_reapplies_finality_policy() {
    // A node loaded from a replay log starts with finality disabled (the log
    // does not persist the policy). Re-applying the depth — what
    // `load_or_genesis` does from the network profile — must prune the
    // now-final blocks without corrupting the current state, and the chain
    // must keep building on the (non-final) tip.
    let log_path = temp_log("finality");
    let founder = KeyPair::from_u64(1);

    let mut node = poa_node(1_000, 1_000);
    for _ in 0..10 {
        node.produce_empty().unwrap();
    }
    node.persist_incremental(&log_path).unwrap();

    let mut recovered = reload_poa(&log_path);
    assert_eq!(
        recovered.finality_depth(),
        u64::MAX,
        "log load starts with finality disabled"
    );

    let balance_before = recovered.balance(&founder.address()).unwrap();
    recovered.set_finality_depth(3).unwrap();
    assert_eq!(recovered.finality_depth(), 3);
    assert_eq!(
        recovered.balance(&founder.address()).unwrap(),
        balance_before,
        "enabling finality must not corrupt the current state"
    );

    // The recovered chain must still accept new blocks on the (non-final) tip.
    recovered.produce_empty().unwrap();
    assert!(
        recovered.block_count().unwrap() > node.block_count().unwrap(),
        "recovered chain must continue after enabling finality"
    );

    remove_log(&log_path);
}

#[test]
fn loaded_node_reapplies_block_pruning() {
    // A node loaded from a replay log starts with block pruning disabled (the
    // log does not persist the policy). Re-applying the depth — what
    // `load_or_genesis` does from the network profile — must evict the
    // now-final blocks (and their reachability-oracle entries) without
    // corrupting the current state, and the chain must keep building on the
    // (non-final) tip (RFC-008).
    let log_path = temp_log("blockprune");
    let founder = KeyPair::from_u64(1);

    let mut node = poa_node(1_000, 1_000);
    for _ in 0..10 {
        node.produce_empty().unwrap();
    }
    node.persist_incremental(&log_path).unwrap();
    let blocks_before = node.block_count().unwrap();

    let mut recovered = reload_poa(&log_path);
    assert_eq!(
        recovered.block_pruning_depth(),
        u64::MAX,
        "log load starts with block pruning disabled"
    );

    let balance_before = recovered.balance(&founder.address()).unwrap();
    // Block pruning is only safe once finality is on (RFC-008 invariant: the
    // effective depth is clamped to `>= finality_depth`), so enable finality
    // first — the order `restore_poa_policy` uses.
    recovered.set_finality_depth(3).unwrap();
    recovered.set_block_pruning_depth(3).unwrap();
    assert_eq!(recovered.block_pruning_depth(), 3);
    assert_eq!(
        recovered.balance(&founder.address()).unwrap(),
        balance_before,
        "enabling block pruning must not corrupt the current state"
    );
    assert!(
        recovered.block_count().unwrap() < blocks_before,
        "final blocks evicted from the loaded DAG"
    );
    let after_prune = recovered.block_count().unwrap();
    let height_after_prune = recovered.chain_height().unwrap();

    // The recovered chain must still accept new blocks on the (non-final) tip.
    // `block_count` is steady-state under pruning (each new block advances the
    // tip and evicts one more old block), so assert on the chain height.
    recovered.produce_empty().unwrap();
    assert!(
        recovered.chain_height().unwrap() > height_after_prune,
        "recovered chain must continue after enabling block pruning"
    );
    assert!(
        recovered.block_count().unwrap() >= after_prune,
        "the DAG stays bounded but non-empty"
    );

    remove_log(&log_path);
}

#[test]
fn poa_log_preserves_authority_block_id() {
    // The identity-preserving-replay invariant, under PoA admission. A block id
    // commits to the authority signature, so replay must re-admit the exact
    // signed bytes — a reader that recomputed or dropped the signature would
    // derive a different id and silently fork the node off its own history.
    let log_path = temp_log("poa");

    let mut node = poa_node(1_000, 1_000);
    let authority_id = node.produce_empty().unwrap();
    node.pool(1, 100, 2).unwrap();
    // A tx-carrying block too: the signature rides on a non-empty payload, so
    // replay must restore the id without re-deriving it from the txs.
    let spend_id = node.produce_block().unwrap().unwrap();
    node.persist_incremental(&log_path).unwrap();

    // Replay under the same PoA policy: the signed blocks must keep their ids.
    let recovered = reload_poa(&log_path);
    let header_ids: Vec<_> = recovered.export_headers().iter().map(|h| h.id).collect();
    for (id, what) in [(authority_id, "empty"), (spend_id, "tx-carrying")] {
        assert!(
            header_ids.contains(&id),
            "authority-signed {what} block id must be preserved across PoA replay"
        );
    }

    remove_log(&log_path);
}
