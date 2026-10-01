//! Tests for the FFI surface — the exact API foreign bindings expose. If a
//! flow works here it works from Kotlin/Swift; anything unreachable through
//! `LightNode` is deliberately not part of the mobile contract.
//!
//! PoA-only (RFC-POA §0). The staking/PoW/hybrid API is gone, so these tests
//! drive production through [`LightNode::set_authority_key_for_tests`], a
//! **Rust-only** seam deliberately kept outside `#[uniffi::export]`: no mobile
//! caller can obtain a consensus signing key through the FFI. It is a test
//! fixture, not an operator key-ingestion path, and it does not resolve
//! blocker B1 (RFC-POA-Migration §0.9) — a wallet on a real network still
//! cannot seal anything, because the node has no way to accept an operator's
//! authority secret.

use ed25519_dalek::SigningKey;
use kovanica_ffi::{LightConfig, LightNode, U128Parts};

/// Nominal work every PoA block carries (`POA_NOMINAL_WORK`): admission is by
/// authority signature, so work carries no ranking weight.
const POA_WORK: U128Parts = U128Parts { high: 0, low: 1 };

/// Three authority signing keys, seeds `AUTHORITY_BASE + i`. The minimum PoA
/// authority set is 3 keys (RFC-POA `MIN_AUTHORITIES`).
const AUTHORITY_BASE: u8 = 0xA1;
const AUTHORITY_N: usize = 3;

fn authority_seeds() -> Vec<[u8; 32]> {
    (0..AUTHORITY_N)
        .map(|i| [AUTHORITY_BASE + i as u8; 32])
        .collect()
}

/// A `LightConfig` whose genesis commits to the test authority set. Every node
/// in a test must use this same config or the genesis id (and therefore the
/// whole chain) diverges.
fn authority_config() -> LightConfig {
    let authority_public_keys = authority_seeds()
        .iter()
        .map(|seed| hex::encode(SigningKey::from_bytes(seed).verifying_key().as_bytes()))
        .collect();
    LightConfig {
        authority_public_keys,
        ..LightConfig::default()
    }
}

/// A producing light node: PoA genesis over the test authority set, holding
/// **all** of its signing keys so it is the scheduled authority in every slot
/// and production never has to wait for a turn.
fn fresh() -> LightNode {
    let node = LightNode::new(authority_config()).expect("genesis ok");
    for seed in authority_seeds() {
        node.set_authority_key_for_tests(seed);
    }
    node
}

/// A light node that knows the authority set but holds **no** signing key —
/// i.e. a real wallet. It can verify every block it accepts, and seal none.
fn wallet() -> LightNode {
    LightNode::new(authority_config()).expect("genesis ok")
}

/// Advance past the RFC-006 coinbase-maturity boundary (100 blocks) so
/// seed 1's genesis coinbase is spendable.
fn mature(node: &LightNode) {
    for _ in 0..100 {
        node.produce_empty_block()
            .expect("holds every authority key, so it is always scheduled");
    }
}

fn temp_path(label: &str) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let mut p = std::env::temp_dir();
    p.push(format!(
        "kovanica-ffi-{}-{n}-{label}.snapshot",
        std::process::id()
    ));
    p.to_string_lossy().into_owned()
}

#[test]
fn genesis_lifecycle_and_queries() {
    let node = fresh();
    assert_eq!(node.balance_of_seed(1).unwrap(), "1000");
    assert_eq!(node.block_count().unwrap(), 1);

    // Tip ids are well-formed hex.
    let tip = node.selected_tip().unwrap();
    assert_eq!(hex::decode(&tip).unwrap().len(), 32);
    assert!(!node.tips().unwrap().is_empty());

    // Address-form balance query accepts the founder's own rendering.
    let addr_hex = kovanica_node::Node::address(1).to_hex();
    assert_eq!(node.balance_of_address(addr_hex).unwrap(), "1000");
}

#[test]
fn poa_blocks_carry_nominal_work() {
    // PoA is the only admission regime, so there is exactly one block kind and
    // `BlockInfo` no longer carries a `kind` field to distinguish a PoW block
    // from a staked one. What is left to pin is the work invariant: every PoA
    // block claims nominal work 1, because admission is by authority signature
    // and not by meeting a work target.
    let node = fresh();
    let info = node.produce_empty_block().unwrap();
    assert_eq!(info.work, POA_WORK, "PoA block must carry nominal work");
    let again = node.produce_empty_block().unwrap();
    assert_eq!(
        again.work, POA_WORK,
        "work must not drift with chain selection"
    );
}

#[test]
fn empty_authority_set_is_rejected() {
    // A light node that cannot name the authority set cannot verify the
    // authority signature on any block it accepts — it would be trusting
    // whichever peer served the block. Fail closed at construction instead.
    let err = LightNode::new(LightConfig::default())
        .err()
        .expect("a node with no authority set must not build");
    assert!(err.to_string().contains("authority_public_keys"), "{err}");
}

#[test]
fn malformed_authority_key_is_rejected() {
    let mut config = authority_config();
    config.authority_public_keys[1] = "not-hex".into();
    let err = LightNode::new(config)
        .err()
        .expect("non-hex authority key must not build");
    assert!(err.to_string().contains("authority_public_keys"), "{err}");

    let mut config = authority_config();
    config.authority_public_keys[1] = "aabb".into();
    let err = LightNode::new(config)
        .err()
        .expect("short authority key must not build");
    assert!(err.to_string().contains("32 bytes"), "{err}");
}

#[test]
fn wallet_without_authority_key_can_verify_but_not_seal() {
    // The security-relevant property of the PoA-only FFI: a node that holds no
    // authority secret still validates the chain (it can read the same blocks a
    // producer made), but every sealing path refuses. No PoW fallback exists to
    // quietly let it through.
    let producer = fresh();
    mature(&producer);
    producer.send(1, 400, 2).unwrap();

    let phone = wallet();
    let applied = phone.receive_blocks(producer.export_blocks()).unwrap();
    // Both nodes start from the same genesis, so the blob contributes every
    // block *except* that one.
    assert_eq!(applied, producer.block_count().unwrap() - 1);
    assert_eq!(
        phone.selected_tip().unwrap(),
        producer.selected_tip().unwrap()
    );
    assert_eq!(phone.balance_of_seed(2).unwrap(), "400");

    // …but it cannot seal: no authority key means no slot, and there is no
    // work target to grind instead.
    let err = phone.send(1, 100, 3).unwrap_err();
    assert!(err.to_string().contains("authority"), "{err}");
    assert!(phone.produce_block().is_err() || phone.produce_block().unwrap().is_none());
    assert!(phone.produce_empty_block().is_err());
}

#[test]
fn sync_blob_between_two_nodes_converges() {
    let producer = fresh();
    mature(&producer);
    producer.produce_empty_block().unwrap();
    producer.send(1, 400, 2).unwrap();
    let producer_tip_before = producer.selected_tip().unwrap();

    // The peer starts identical (genesis) and catches up purely from bytes.
    let peer = fresh();

    let applied = peer.receive_blocks(producer.export_blocks()).unwrap();
    assert!(
        applied >= 2,
        "at least the coinbase and the send block, got {applied}"
    );
    assert_eq!(peer.selected_tip().unwrap(), producer_tip_before);
    assert_eq!(
        peer.balance_of_seed(2).unwrap(),
        producer.balance_of_seed(2).unwrap()
    );

    // Idempotent: re-offering the same history adopts nothing new
    // (known blocks re-validate as no-ops rather than erroring).
    let before = peer.block_count().unwrap();
    let _ = peer.receive_blocks(producer.export_blocks()).unwrap();
    assert_eq!(peer.block_count().unwrap(), before);
}

#[test]
fn garbage_sync_blob_is_rejected_not_panicked_on() {
    let peer = fresh();
    let err = peer.receive_blocks(vec![0xFF; 64]).unwrap_err();
    assert!(
        err.to_string().to_lowercase().contains("blob") || err.to_string().contains("undecodable")
    );
}

#[test]
fn snapshot_roundtrip_preserves_authority_ids_and_keeps_producing() {
    let node = fresh();
    mature(&node);
    let authority_block = node.produce_empty_block().unwrap();
    assert_eq!(authority_block.work, POA_WORK);

    let path = temp_path("roundtrip");
    node.save_snapshot(path.clone()).unwrap();

    // A snapshot stores the ledger but NOT the admission config, so the
    // authority set has to be supplied again on load — same contract as the
    // full node's `restore_poa_policy`. PoA replay is what keeps every
    // authority-signed id intact.
    let restored = fresh();
    restored
        .load_snapshot(path.clone(), authority_config())
        .unwrap();
    assert_eq!(
        restored.selected_tip().unwrap(),
        node.selected_tip().unwrap()
    );

    let back = restored
        .block_by_id(authority_block.id_hex.clone())
        .unwrap()
        .expect("authority-signed id survived");
    assert_eq!(back.work, POA_WORK);

    // And the restored node can keep producing immediately.
    let next = restored.produce_empty_block().unwrap();
    assert_eq!(next.work, POA_WORK);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn send_from_uses_imported_secret_without_storing_it() {
    let node = fresh();
    mature(&node);

    // The demo founder's secret is from_u64(1): le bytes zero-padded.
    let mut founder_secret = [0u8; 32];
    founder_secret[..8].copy_from_slice(&1u64.to_le_bytes());

    let to_addr = kovanica_node::Node::address(2).to_hex();
    let receipt = node
        .send_from(hex::encode(founder_secret), 400, to_addr.clone())
        .unwrap();
    assert_eq!(node.balance_of_seed(2).unwrap(), "400");
    assert!(node.block_by_id(receipt.block_id_hex).unwrap().is_some());

    // Wrong-length secrets are rejected up front.
    let err = node.send_from("abcd".to_string(), 1, to_addr).unwrap_err();
    assert!(err.to_string().contains("32 bytes"), "{err}");
}

#[test]
fn light_sync_filters_and_proofs_end_to_end() {
    let producer = fresh();
    mature(&producer);
    producer.send(1, 300, 2).unwrap(); // a real payment to watch

    // Phone receives the selected chain as headers + filters only.
    let phone = fresh();
    let blob = producer.export_light_sync();
    let accepted = phone.receive_light_sync(blob.clone()).unwrap();
    assert_eq!(accepted, producer.block_count().unwrap());
    assert!(phone.synced_height().is_some());

    // Idempotent re-sync.
    let before = phone.synced_height();
    phone.receive_light_sync(blob).unwrap();
    assert_eq!(phone.synced_height(), before);

    // The payment's recipient address shows up in exactly that block's filter.
    let receipt = producer.send(1, 100, 3).unwrap();
    let _ = phone
        .receive_light_sync(producer.export_light_sync())
        .unwrap();
    let addr3 = kovanica_node::Node::address(3);
    match phone
        .synced_filter_matches(receipt.block_id_hex.clone(), addr3.to_hex())
        .unwrap()
    {
        Some(hit) => assert!(hit, "recipient must hit the filter"),
        None => panic!("block should be synced"),
    }
    // A stranger's address misses (definitive).
    let stranger = kovanica_node::Node::address(42);
    assert_eq!(
        phone
            .synced_filter_matches(receipt.block_id_hex.clone(), stranger.to_hex())
            .unwrap(),
        Some(false)
    );

    // Inclusion proof: verifies against the synced header root.
    let tx_hex = receipt.tx_id_hex.clone();
    let proof = producer
        .prove_tx(receipt.block_id_hex.clone(), tx_hex.clone())
        .unwrap()
        .expect("tx in block");
    assert!(phone
        .verify_tx_proof(proof, receipt.block_id_hex.clone())
        .unwrap());

    // Tampered proof is rejected. Single-tx blocks prove as bare leaves
    // (empty path, len 84), so corrupt the merkle-root region itself.
    let mut bad = producer
        .prove_tx(receipt.block_id_hex.clone(), tx_hex)
        .unwrap()
        .unwrap();
    assert_eq!(bad.len(), 84, "single-payload-tx block ⇒ leaf-only proof");
    bad[40] ^= 0xFF;
    assert!(!phone.verify_tx_proof(bad, receipt.block_id_hex).unwrap());
}

#[test]
fn standalone_filter_blob_roundtrips_and_matches() {
    let node = fresh();
    let tip = node.selected_tip().unwrap(); // genesis: founder-funded output
    let filter = node.block_filter(tip.clone()).unwrap();
    let founder = kovanica_node::Node::address(1);
    assert!(node
        .filter_matches(filter.clone(), founder.to_hex())
        .unwrap());
    let stranger = kovanica_node::Node::address(77);
    assert!(!node.filter_matches(filter, stranger.to_hex()).unwrap());
}

#[test]
fn garbage_light_sync_is_rejected_not_panicked_on() {
    let phone = fresh();
    assert!(phone.receive_light_sync(vec![0u8; 40]).is_err());
}

#[test]
fn history_over_ffi_matches_utxo_semantics() {
    let node = fresh();
    // Genesis coinbase is exempt from maturity (creation_height == 0), so it
    // can be spent immediately without mining 100 blocks.
    node.send(1, 400, 2).unwrap();

    let founder_hex = kovanica_node::Node::address(1).to_hex();
    let hist = node.history_of(founder_hex.clone(), 0).unwrap();
    let summary: Vec<(String, bool)> = hist
        .iter()
        .map(|e| {
            (
                e.amount.clone(),
                e.direction == kovanica_ffi::TxDirection::Received,
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            ("1000".into(), true),  // genesis coinbase
            ("1000".into(), false), // coin consumed by the send
            ("599".into(), true),   // change (fee = 1)
        ]
    );
    for e in &hist {
        assert_eq!(hex::decode(&e.tx_id_hex).unwrap().len(), 32);
        assert_eq!(hex::decode(&e.block_id_hex).unwrap().len(), 32);
    }

    // The human `kvnc…dag` address form parses too.
    let kvnc = kovanica_node::Node::address(1).to_kvnc();
    assert_eq!(node.history_of(kvnc, 0).unwrap().len(), 3);

    // Uninvolved address and bounded scans behave.
    assert!(node
        .history_of(kovanica_node::Node::address(9).to_hex(), 0)
        .unwrap()
        .is_empty());
    assert_eq!(node.history_of(founder_hex, 1).unwrap().len(), 1);
}

#[test]
fn filter_matches_any_batches_watch_addresses() {
    let node = fresh();
    let tip = node.selected_tip().unwrap(); // genesis
    let blob = node.block_filter(tip).unwrap();

    let founder = kovanica_node::Node::address(1).to_hex();
    let bystander = kovanica_node::Node::address(7).to_hex();

    // Batch hit when any watched address matches…
    assert!(node
        .filter_matches_any(blob.clone(), vec![bystander.clone(), founder.clone()])
        .unwrap());
    // …and batch agrees with the single-address query.
    assert_eq!(
        node.filter_matches_any(blob.clone(), vec![founder.clone()])
            .unwrap(),
        node.filter_matches(blob.clone(), founder.clone()).unwrap()
    );

    // Empty watch list never matches; malformed filters error cleanly.
    assert!(!node.filter_matches_any(blob.clone(), vec![]).unwrap());
    assert!(node
        .filter_matches_any(vec![0u8; 9], vec![founder])
        .is_err());
}

#[test]
fn send_to_script_v2_and_stealth_over_ffi() {
    let node = fresh();
    // Genesis coinbase is exempt from maturity (creation_height == 0), so it
    // can be spent immediately without mining 100 blocks.

    // The deterministic founder actor (seed 1) is funded by genesis (1000).
    // Its Ed25519 secret is the little-endian encoding of 1 padded to 32 bytes.
    let founder_secret = "0100000000000000000000000000000000000000000000000000000000000000";

    // Script v2: send 200 to a script, then check the balance.
    let script_hex = "0102030405";
    let tx_id = node
        .send_to_script_v2(founder_secret.into(), 200, script_hex.into())
        .unwrap();
    assert_eq!(hex::decode(&tx_id).unwrap().len(), 32);
    assert_eq!(node.balance_of_script(script_hex.into()).unwrap(), 200);

    // Stealth: build a stealth address from scan key (seed 2) + spend key (seed 3).
    let scan_pk = *kovanica_node::Node::address(2).payload();
    let spend_pk = *kovanica_node::Node::address(3).payload();
    let stealth = kovanica_state::StealthAddress::new(scan_pk, spend_pk);
    let stealth_hex = stealth.to_hex();
    assert_eq!(stealth_hex.len(), 130);

    // Send 300 to the stealth address, then check the balance.
    let tx_id = node
        .send_to_stealth(founder_secret.into(), 300, stealth_hex.clone())
        .unwrap();
    assert_eq!(hex::decode(&tx_id).unwrap().len(), 32);
    assert_eq!(node.balance_of_stealth(stealth_hex).unwrap(), 300);

    // Sender's remaining balance: 1000 - 200 - 300 - 2 fees = 498.
    assert_eq!(node.balance_of_seed(1).unwrap(), "498");
}

#[test]
fn htlc_over_ffi() {
    let node = fresh();
    mature(&node);

    // The deterministic founder actor (seed 1) is funded by genesis (1000).
    // Its Ed25519 secret is the little-endian encoding of 1 padded to 32 bytes.
    let founder_secret = "0100000000000000000000000000000000000000000000000000000000000000";
    let recipient_secret = "0200000000000000000000000000000000000000000000000000000000000000";

    // Recipient (Bob) is seed 2; sender (Alice) is the founder.
    let recipient_pk = hex::encode(kovanica_node::Node::address(2).payload());

    // Preimage + its BLAKE3 hash through the FFI helper.
    let preimage = [0x42u8; 32];
    let preimage_hash = node.htlc_preimage_hash_hex(hex::encode(preimage)).unwrap();
    assert_eq!(hex::decode(&preimage_hash).unwrap().len(), 32);

    // Build the template directly and check it round-trips.
    let script_hex = node
        .htlc_script_hex(
            preimage_hash.clone(),
            recipient_pk.clone(),
            hex::encode(kovanica_node::Node::address(1).payload()),
            1,
        )
        .unwrap();
    assert_eq!(hex::decode(&script_hex).unwrap().len(), 100);

    // Create the HTLC: founder locks 200 to Bob, timeout 1.
    let info = node
        .create_htlc(
            founder_secret.into(),
            200,
            None,
            recipient_pk.clone(),
            preimage_hash.clone(),
            1,
        )
        .unwrap();
    assert_eq!(info.script_hex, script_hex);
    assert_eq!(hex::decode(&info.tx_id).unwrap().len(), 32);
    assert_eq!(hex::decode(&info.outpoint_tx).unwrap().len(), 32);
    assert_eq!(info.outpoint_index, 0);
    assert!(info.address.starts_with("kvnc"));
    assert_eq!(node.balance_of_htlc(script_hex.clone()).unwrap(), 200);

    // Redeem: Bob redeems with the preimage to his own address (BIP-199: no
    // time constraint, even though the chain has passed T = 1).
    let redeem_tx = node
        .redeem_htlc(
            recipient_secret.into(),
            info.outpoint_tx.clone(),
            info.outpoint_index,
            script_hex.clone(),
            hex::encode(preimage),
            kovanica_node::Node::address(2).to_hex(),
        )
        .unwrap();
    assert_eq!(hex::decode(&redeem_tx).unwrap().len(), 32);
    assert_eq!(node.balance_of_htlc(script_hex.clone()).unwrap(), 0);

    // Refund path: founder locks a second HTLC (timeout 1) and refunds it
    // once the chain height reaches the timeout.
    let info2 = node
        .create_htlc(
            founder_secret.into(),
            150,
            None,
            recipient_pk,
            preimage_hash,
            1,
        )
        .unwrap();
    assert_eq!(node.balance_of_htlc(info2.script_hex.clone()).unwrap(), 150);
    let refund_tx = node
        .refund_htlc(
            founder_secret.into(),
            info2.outpoint_tx,
            info2.outpoint_index,
            info2.script_hex.clone(),
            kovanica_node::Node::address(1).to_hex(),
        )
        .unwrap();
    assert_eq!(hex::decode(&refund_tx).unwrap().len(), 32);
    assert_eq!(node.balance_of_htlc(info2.script_hex).unwrap(), 0);
}

#[test]
fn swap_session_over_ffi() {
    use kovanica_node::{SwapParams, SwapRole, SwapSession};

    let node = fresh();
    let founder_secret = "0100000000000000000000000000000000000000000000000000000000000000";
    let preimage = [0x42u8; 32];

    let alice_pk = *kovanica_node::Node::address(1).payload();
    let bob_pk = *kovanica_node::Node::address(2).payload();

    // Construct the swap session via the node API: Alice swaps 500 for Bob's
    // 400, T_B = 1 < T_A = 3.
    let session = SwapSession::new(
        &SwapParams {
            amount_a: 500,
            asset_a: None,
            amount_b: 400,
            asset_b: None,
            timeout_a: 3,
            timeout_b: 1,
        },
        alice_pk,
        bob_pk,
        preimage,
    )
    .unwrap();

    // The session's HTLC-A template matches what the FFI template builder
    // produces for the same parameters.
    let script_hex = node
        .htlc_script_hex(
            hex::encode(session.preimage_hash),
            hex::encode(bob_pk),
            hex::encode(alice_pk),
            session.htlc_a.timeout(),
        )
        .unwrap();
    assert_eq!(script_hex, hex::encode(session.htlc_a.bytes()));

    // Create HTLC-A through the FFI surface and verify the session recognizes
    // it as Bob's leg (and rejects it as Alice's).
    let info = node
        .create_htlc(
            founder_secret.into(),
            500,
            None,
            hex::encode(bob_pk),
            hex::encode(session.preimage_hash),
            session.htlc_a.timeout(),
        )
        .unwrap();
    let on_chain =
        kovanica_state::htlc::HtlcScript::parse(&hex::decode(&info.script_hex).unwrap()).unwrap();
    assert!(session.verify_against(&on_chain, SwapRole::Bob));
    assert!(!session.verify_against(&on_chain, SwapRole::Alice));

    // Timeout ordering is enforced: T_B must be strictly less than T_A.
    let bad = SwapParams {
        amount_a: 500,
        asset_a: None,
        amount_b: 400,
        asset_b: None,
        timeout_a: 1,
        timeout_b: 3,
    };
    assert!(SwapSession::new(&bad, alice_pk, bob_pk, preimage).is_err());
}
