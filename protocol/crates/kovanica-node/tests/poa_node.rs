//! Node-level Proof-of-Authority genesis wiring (RFC-POA M3).
//!
//! M3 exit criteria at the node layer: `Node::genesis_with_poa` commits the
//! authority set to the genesis coinbase tag (`KVA1 || set_hash`), enables PoA
//! admission on the ledger, and different authority sets produce different
//! genesis ids (the hard-fork marker). `enable_poa`/`poa_enabled`/`poa_config`
//! mirror the hybrid surface.

use ed25519_dalek::SigningKey;
use kovanica_dag::{AuthorityPublicKey, AuthoritySet, BlockId};
use kovanica_node::{Node, NodeError};
use kovanica_state::{parse_poa_genesis_tag, ATOM};

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;

fn keypair(seed: u8) -> (SigningKey, AuthorityPublicKey) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = sk.verifying_key();
    (sk, pk)
}

/// An `n`-authority set with keys derived from seeds `base..base+n`.
fn authority_set_with_base(base: u8, n: u8, threshold: usize) -> (AuthoritySet, Vec<SigningKey>) {
    let mut keys = Vec::new();
    let mut sks = Vec::new();
    for i in 0..n {
        let (sk, pk) = keypair(base + i);
        keys.push(pk);
        sks.push(sk);
    }
    (AuthoritySet::new(keys, threshold).unwrap(), sks)
}

fn authority_set(n: u8, threshold: usize) -> (AuthoritySet, Vec<SigningKey>) {
    authority_set_with_base(1, n, threshold)
}

/// The genesis coinbase tag of `node`'s ledger, decoded from the genesis block.
fn genesis_coinbase_tag(node: &Node) -> Vec<u8> {
    let ledger = node.ledger().expect("ledger initialised");
    let genesis_id = ledger.genesis();
    let genesis = ledger
        .dag()
        .block(&genesis_id)
        .expect("genesis block present");
    let txs = kovanica_state::decode_block_payload(genesis.payload()).expect("payload decodes");
    let coinbase = txs
        .iter()
        .find(|tx| tx.inputs().is_empty())
        .expect("genesis coinbase present");
    coinbase.tag().to_vec()
}

#[test]
fn genesis_with_poa_commits_authority_set_and_enables_poa() {
    let (set, _sks) = authority_set(3, 2);
    let mut node = Node::new();
    let (genesis_id, _founder) = node
        .genesis_with_poa(
            3,
            10 * ATOM,
            200_000 * ATOM,
            1,
            None,
            u64::MAX,
            u64::MAX,
            u64::MAX,
            None,
            set.clone(),
            SLOT_MS,
        )
        .expect("PoA genesis succeeds");

    // The genesis coinbase tag commits to the authority set.
    let tag = genesis_coinbase_tag(&node);
    assert_eq!(
        parse_poa_genesis_tag(&tag),
        Some(set.hash()),
        "genesis coinbase commits to the authority set"
    );

    // PoA admission is live on the ledger.
    assert!(node.poa_enabled(), "PoA enabled after PoA genesis");
    let cfg = node.poa_config().expect("PoA config present");
    assert_eq!(cfg.authority_set, set);
    assert_eq!(cfg.slot_duration_ms, SLOT_MS);

    // The genesis id is well-formed and non-trivial.
    assert_ne!(genesis_id, BlockId::from_bytes([0; 32]));
}

#[test]
fn different_authority_sets_produce_different_genesis() {
    let (set_a, _) = authority_set(3, 2);
    let (set_b, _) = authority_set_with_base(11, 3, 2);
    assert_ne!(set_a.hash(), set_b.hash(), "distinct sets");

    let mut node_a = Node::new();
    let (genesis_a, _) = node_a
        .genesis_with_poa(
            3,
            10 * ATOM,
            200_000 * ATOM,
            1,
            None,
            u64::MAX,
            u64::MAX,
            u64::MAX,
            None,
            set_a,
            SLOT_MS,
        )
        .expect("genesis A");

    let mut node_b = Node::new();
    let (genesis_b, _) = node_b
        .genesis_with_poa(
            3,
            10 * ATOM,
            200_000 * ATOM,
            1,
            None,
            u64::MAX,
            u64::MAX,
            u64::MAX,
            None,
            set_b,
            SLOT_MS,
        )
        .expect("genesis B");

    assert_ne!(
        genesis_a, genesis_b,
        "different authority sets must fork the genesis id"
    );
}

#[test]
fn poa_genesis_differs_from_legacy_genesis() {
    let (set, _sks) = authority_set(3, 2);

    let mut poa_node = Node::new();
    let (poa_genesis, _) = poa_node
        .genesis_with_poa(
            3,
            10 * ATOM,
            200_000 * ATOM,
            1,
            None,
            u64::MAX,
            u64::MAX,
            u64::MAX,
            None,
            set,
            SLOT_MS,
        )
        .expect("PoA genesis");

    let mut legacy_node = Node::new();
    let (legacy_genesis, _) = legacy_node
        .genesis_with_finality(
            3,
            10 * ATOM,
            200_000 * ATOM,
            1,
            None,
            u64::MAX,
            u64::MAX,
            u64::MAX,
            None,
        )
        .expect("legacy genesis");

    assert_ne!(
        poa_genesis, legacy_genesis,
        "PoA genesis commits to the authority set; legacy genesis does not"
    );
    assert!(poa_node.poa_enabled());
    assert!(!legacy_node.poa_enabled());
}

#[test]
fn enable_poa_after_legacy_genesis_switches_admission() {
    let (set, _sks) = authority_set(3, 2);
    let mut node = Node::new();
    node.genesis_with_finality(
        3,
        10 * ATOM,
        200_000 * ATOM,
        1,
        None,
        u64::MAX,
        u64::MAX,
        u64::MAX,
        None,
    )
    .expect("legacy genesis");

    assert!(!node.poa_enabled());
    node.enable_poa(set.clone(), SLOT_MS).expect("enable_poa");
    assert!(node.poa_enabled());
    assert_eq!(node.poa_config().unwrap().authority_set, set);
}

#[test]
fn enable_poa_requires_initialised_ledger() {
    let (set, _sks) = authority_set(3, 2);
    let mut node = Node::new();
    let err = node.enable_poa(set, SLOT_MS).expect_err("not initialised");
    assert!(matches!(err, NodeError::NotInitialized));
}

// ---------------------------------------------------------------------------
// PoA load-path round-trip (M3 exit criterion: a PoA-era log reloads with its
// ids preserved and PoA admission re-enforced — the `load_log_with_poa*`
// readers mirror the hybrid `_with_hybrid` readers).
// ---------------------------------------------------------------------------

fn temp_log(name: &str) -> String {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "kovanica-poa-{}-{}-{}",
        name,
        std::process::id(),
        rand::random::<u64>()
    ));
    path.set_extension("log");
    path.to_str().unwrap().to_string()
}

fn remove_log(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[test]
fn poa_log_roundtrip_preserves_ids_and_re_enforces_admission() {
    let (set, sks) = authority_set(3, 2);
    let log_path = temp_log("roundtrip");

    // Produce authority-signed blocks on the original node (all three keys so
    // a single node can produce in every slot, mirroring the explorer's
    // placeholder bootstrap).
    let mut node = Node::new();
    node.genesis_with_poa(
        3,
        10 * ATOM,
        200_000 * ATOM,
        1,
        None,
        u64::MAX,
        u64::MAX,
        u64::MAX,
        None,
        set.clone(),
        SLOT_MS,
    )
    .expect("PoA genesis");
    for sk in &sks {
        node.set_authority_signing_key(sk.to_bytes());
    }
    for _ in 0..3 {
        node.produce_empty().expect("authority-signed block");
    }
    let headers_before: Vec<_> = node.export_headers().iter().map(|h| h.id).collect();
    node.persist_incremental(&log_path).expect("persist");

    // Rebuild with the PoA reader: ids preserved, PoA re-enforced.
    let mut recovered = Node::load_log_with_poa_and_policy(
        &log_path,
        set.clone(),
        SLOT_MS,
        kovanica_state::PruningPolicy {
            finality_depth: u64::MAX,
            payload_pruning_depth: u64::MAX,
            block_pruning_depth: u64::MAX,
        },
    )
    .expect("PoA log load");
    let headers_after: Vec<_> = recovered.export_headers().iter().map(|h| h.id).collect();
    assert_eq!(
        headers_before, headers_after,
        "block ids must match across restart"
    );
    assert!(recovered.poa_enabled(), "PoA re-enabled by the poa reader");
    assert_eq!(recovered.poa_config().unwrap().authority_set, set);

    // Live admission still enforces PoA after the load: an unsigned block is
    // rejected with an authority error.
    let g = recovered.ledger().unwrap().genesis();
    let err = recovered
        .receive_block(kovanica_node::BlockRecord {
            parents: vec![g],
            work: 1,
            timestamp_ms: 0,
            nonce: 0,
            authority_sig: None,
            txs: Vec::new(),
        })
        .expect_err("unsigned block must be rejected after PoA load");
    assert!(
        err.to_string().contains("authority"),
        "expected an authority error, got: {err}"
    );

    // A signed block is accepted after the load (keys are node-local identity,
    // restored by the operator — the load never restores them).
    for sk in &sks {
        recovered.set_authority_signing_key(sk.to_bytes());
    }
    recovered.produce_empty().expect("signed block after load");

    remove_log(&log_path);
}

#[test]
fn plain_log_load_preserves_ids_but_does_not_enforce_poa() {
    // The plain `load_log` reader replays PoA-era blocks with their original
    // ids (replay skips admission checks) but does NOT re-enable PoA — which
    // is exactly why `load_or_genesis` re-applies the policy afterwards
    // (defense-in-depth). This test pins that contract.
    let (set, sks) = authority_set(3, 2);
    let log_path = temp_log("plain-load");

    let mut node = Node::new();
    node.genesis_with_poa(
        3,
        10 * ATOM,
        200_000 * ATOM,
        1,
        None,
        u64::MAX,
        u64::MAX,
        u64::MAX,
        None,
        set.clone(),
        SLOT_MS,
    )
    .expect("PoA genesis");
    for sk in &sks {
        node.set_authority_signing_key(sk.to_bytes());
    }
    node.produce_empty().expect("authority-signed block");
    let headers_before: Vec<_> = node.export_headers().iter().map(|h| h.id).collect();
    node.persist_incremental(&log_path).expect("persist");

    let recovered = Node::load_log(&log_path).expect("plain log load");
    let headers_after: Vec<_> = recovered.export_headers().iter().map(|h| h.id).collect();
    assert_eq!(headers_before, headers_after, "ids preserved by replay");
    assert!(
        !recovered.poa_enabled(),
        "plain load does not re-enable PoA (the caller must re-apply it)"
    );

    remove_log(&log_path);
}
