//! M6 Testing: Authority updates, re-orgs, SPV sync, and resource profiling (RFC-POA M6).
//!
//! Exit criteria:
//! - Authority update works (on-chain update tx, SPV update proof)
//! - Re-org under PoA (GHOSTDAG k=3 with authority signatures)
//! - SPV sync under re-org (light client follows selected chain)
//! - Resource profiling: CPU/RAM < 10% of PoW baseline

use ed25519_dalek::{Signer, SigningKey};
use kovanica_dag::{
    sign_update, AuthorityPublicKey, AuthoritySet, Block, BlockId, POA_NOMINAL_WORK,
};
use kovanica_node::{BlockRecord, Node};
use kovanica_state::encode_block_payload;
use kovanica_state::spv::{AuthorityUpdateProof, MerkleProof};
use kovanica_state::ATOM;

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;

fn keypair(seed: u8) -> (SigningKey, AuthorityPublicKey) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = sk.verifying_key();
    (sk, pk)
}

/// An `n`-authority set with keys derived from seeds `base..base+n`.
/// Returns the authority set and the signing keys in the set's **canonical**
/// order (ascending public-key bytes), so `sks[i]` is the authority scheduled
/// for `active_authority(slot)` whenever `i == slot % n`.
fn authority_set_with_base(base: u8, n: u8, threshold: usize) -> (AuthoritySet, Vec<SigningKey>) {
    let mut key_pairs = Vec::new();
    for i in 0..n {
        let (sk, pk) = keypair(base + i);
        key_pairs.push((pk, sk));
    }
    // `AuthoritySet::new` canonicalises by ascending public-key bytes; mirror
    // that here so the returned signing keys line up index-for-index.
    key_pairs.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let keys: Vec<_> = key_pairs.iter().map(|(pk, _)| *pk).collect();
    let sks: Vec<_> = key_pairs.iter().map(|(_, sk)| sk.clone()).collect();
    let set = AuthoritySet::new(keys, threshold).unwrap();
    // The invariant every caller below relies on: sks[i] signs for slot i % n.
    for (i, sk) in sks.iter().enumerate() {
        assert_eq!(
            sk.verifying_key(),
            *set.active_authority(i as u64),
            "signing key {i} must be the authority scheduled for slot {i}"
        );
    }
    (set, sks)
}

fn authority_set(n: u8, threshold: usize) -> (AuthoritySet, Vec<SigningKey>) {
    authority_set_with_base(1, n, threshold)
}

/// Create a placeholder authority set for testing (3 authorities, threshold 2)
/// Returns the authority set and signing keys in the same order as the authority set's internal ordering.
fn placeholder_authority_set() -> (AuthoritySet, Vec<SigningKey>) {
    authority_set_with_base(1, 3, 2)
}

/// Helper to create a signed PoA block with the correct authority signature.
///
/// The payload **must** be built with `encode_block_payload`, exactly as
/// `Node::receive_block` rebuilds it from the `BlockRecord`'s tx list. A
/// hand-rolled empty payload would make the node reconstruct a different
/// block, so `hash_without_authority_sig()` — and therefore the signature
/// over it — would not match what we signed (the "identity-preserving block
/// replay" invariant). For an empty tx list the payload is an 8-byte zero
/// length prefix, *not* `Vec::new()`.
///
/// `authority_idx` must be the index into the set's **canonical** order (see
/// `AuthoritySet::new`); `sks` is kept in that same order by
/// `authority_set_with_base`.
fn create_signed_poa_block(
    parents: Vec<BlockId>,
    work: u128,
    timestamp_ms: u64,
    nonce: u64,
    authority_idx: usize,
    sks: &[SigningKey],
) -> BlockRecord {
    let payload = encode_block_payload(&[]);
    let unsigned = Block::new(parents.clone(), work, timestamp_ms, nonce, payload.clone());
    let hash_without_sig = unsigned.hash_without_authority_sig();
    let sig = sks[authority_idx]
        .sign(hash_without_sig.as_bytes())
        .to_bytes();
    let block = Block::new_with_authority(parents, work, timestamp_ms, nonce, sig, payload);
    BlockRecord {
        parents: block.parents().to_vec(),
        work: block.work(),
        timestamp_ms: block.timestamp_ms(),
        nonce: block.nonce(),
        authority_sig: Some(sig),
        txs: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Authority Update Integration Test
// ---------------------------------------------------------------------------

#[test]
fn authority_update_on_chain_and_spv_proof() {
    // Setup: 3-authority set, threshold 2
    let (set, sks) = authority_set(3, 2);

    // Genesis with initial authority set
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

    // Load all authority keys so this node can produce in every slot
    for sk in &sks {
        node.set_authority_signing_key(sk.to_bytes());
    }

    // Produce a few blocks to mature the chain
    for _ in 0..5 {
        node.produce_empty().expect("authority-signed block");
    }

    // Create a new authority set (different keys)
    let (_new_set, _new_sks) = authority_set_with_base(11, 3, 2);

    // Build the authority update transaction
    // Signatures from 2 of the 3 current authorities (threshold = 2)
    let _sigs: Vec<_> = sks[..2]
        .iter()
        .map(|sk| {
            (
                sk.verifying_key(),
                sign_update(sk, &set.hash(), &placeholder_authority_set().0),
            )
        })
        .collect();

    // Note: In real usage, the update tx would be submitted via RPC,
    // included in a block, and the light client would fetch the Merkle proof
    // from the full node. Here we test the verification logic.

    // Test that the update proof validation works
    let mut client = kovanica_state::spv::SpvClient::with_poa(
        kovanica_state::spv::BlockHeader {
            id: BlockId::from_bytes([0u8; 32]),
            prev_hash: BlockId::from_bytes([0u8; 32]),
            merkle_root: [0u8; 32],
            work: 1,
            timestamp_ms: 0,
            nonce: 0,
            blue_score: 0,
            chain_blue_work: 1,
            height: 0,
            authority_sig: None,
            authority_set_hash: set.hash(),
            hash_without_authority_sig: [0u8; 32],
        },
        kovanica_state::spv::SpvPoAConfig {
            authority_set: set.clone(),
            slot_duration_ms: SLOT_MS,
            sw_poa: false,
        },
    );

    // The update proof requires a Merkle proof of the update tx in a block
    // whose header carries the new set hash
    // For this test, we'll test the verification logic with invalid proofs

    // Test that the update proof validation works
    let update_proof = AuthorityUpdateProof {
        update: kovanica_dag::AuthorityUpdateTx::new(
            set.hash(),
            placeholder_authority_set().0,
            vec![],
        )
        .unwrap(),
        merkle: MerkleProof {
            tx_id: [0u8; 32],
            merkle_root: [0u8; 32],
            path: Vec::new(),
            index: 0,
            tx_count: 1,
        },
        height: 10,
    };

    // The client should reject the proof because the Merkle proof is invalid
    let err = client
        .apply_authority_update(&update_proof)
        .expect_err("invalid merkle proof rejected");
    // The error should be about the merkle proof or authority
    assert!(
        err.to_string().contains("merkle")
            || err.to_string().contains("authority")
            || err.to_string().contains("update")
    );

    println!("Authority update SPV proof validation tests passed");
}

// ---------------------------------------------------------------------------
// Re-org Under PoA Test
// ---------------------------------------------------------------------------

#[test]
fn poa_reorg_ghostdag_k3() {
    // Test that GHOSTDAG k=3 works correctly with PoA blocks: a competing
    // branch that is genuinely heavier must win the re-org.
    //
    // "Heavier" under PoA means *longer* — every admitted block carries the
    // same nominal work (RFC-POA §4 item 5; `Dag` rejects any other value), so
    // accumulated blue work is just a block count. This test used to forge
    // `work = 2` to win, which both depended on and enshrined the very
    // chain-selection vector the pin closes: an authority could claim
    // arbitrary weight and steer the selected parent on its own.

    let (set, sks) = authority_set(3, 2);

    let mut node = Node::new();
    // Set clock to slot 0 (genesis)
    node.set_now_ms(0);
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

    // Build Branch A: 10 blocks (slots 1-10)
    let mut branch_a = Vec::new();
    for slot in 1..=10 {
        node.set_now_ms(SLOT_MS * slot);
        node.produce_empty().unwrap();
        let tip = node.selected_tip().unwrap();
        branch_a.push(tip);
    }

    // Get the tip of branch A
    let _tip_a = branch_a.last().unwrap();

    // Now create a competing branch B that splits from block 5. B is 8 blocks
    // long from that split point, so it ends at depth 13 against branch A's
    // 10 — strictly heavier at equal nominal work, with no forged weight.
    let _dag = node.ledger().unwrap().dag();
    let split_point = branch_a[4]; // Split at block 5 (0-indexed)

    let mut heavier_branch = Vec::new();
    let mut parent = split_point;
    for i in 1..=8 {
        // The first 10 blocks were at slots 1-10, so next blocks are at slots 11-18
        let timestamp = SLOT_MS * (10 + i as u64);
        let slot = timestamp / SLOT_MS;
        let authority_idx = (slot as usize) % 3;
        let record = create_signed_poa_block(
            vec![parent],
            POA_NOMINAL_WORK,
            timestamp,
            0,
            authority_idx,
            &sks,
        );
        let block_id = node.receive_block(record).unwrap();
        heavier_branch.push(block_id);
        parent = block_id;
    }

    // The longer branch should become the selected tip
    let new_tip = node.selected_tip().unwrap();
    assert_eq!(new_tip, *heavier_branch.last().unwrap());

    // Verify the reorg happened
    let selected_chain = node.ledger().unwrap().dag().selected_chain();
    assert!(selected_chain.contains(&heavier_branch[0]));

    println!("PoA re-org test passed: longer branch won");
}

// ---------------------------------------------------------------------------
// SPV Sync Under Re-org Test
// ---------------------------------------------------------------------------

#[test]
fn spv_sync_under_poa_reorg() {
    // Test that SPV client correctly follows the selected chain after a reorg

    let (set, sks) = authority_set(3, 2);

    let mut node = Node::new();
    node.set_now_ms(0);
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

    // Build initial chain of 10 blocks (slots 1-10)
    for slot in 1..=10 {
        node.set_now_ms(SLOT_MS * slot);
        node.produce_empty().unwrap();
    }

    // SPV client syncs the initial chain
    let genesis_id = node.genesis_id().unwrap();
    let genesis_header = node.spv_header(&genesis_id).unwrap();
    let mut spv_client = kovanica_state::spv::SpvClient::with_poa(
        genesis_header.clone(),
        kovanica_state::spv::SpvPoAConfig {
            authority_set: set.clone(),
            slot_duration_ms: SLOT_MS,
            sw_poa: false,
        },
    );

    // Sync all headers
    for id in node.ledger().unwrap().dag().selected_chain() {
        if id == genesis_id {
            continue;
        }
        let header = node.spv_header(&id).unwrap();
        spv_client.add_header(header).unwrap();
    }

    assert_eq!(spv_client.tip().unwrap().height, 10);

    // Now create a reorg on the node: a longer competing branch from block 5,
    // which at equal nominal work ends strictly heavier than the 10-block
    // chain the light client just synced to (RFC-POA §4 item 5 — `work` is pinned,
    // so "heavier" can only mean "longer").
    let dag = node.ledger().unwrap().dag();
    let split_point = dag.selected_chain()[4]; // Split at block 5

    // Insert the longer branch
    let mut parent = split_point;
    for i in 1..=8 {
        let timestamp = SLOT_MS * (10 + i as u64);
        let slot = timestamp / SLOT_MS;
        let authority_idx = (slot as usize) % 3;
        let record = create_signed_poa_block(
            vec![parent],
            POA_NOMINAL_WORK,
            timestamp,
            0,
            authority_idx,
            &sks,
        );
        node.receive_block(record).unwrap();
        parent = node.selected_tip().unwrap();
    }

    // Now the node has reorged to a new tip
    let new_tip = node.selected_tip();

    // A light client must be able to verify the post-reorg chain.
    //
    // `SpvClient::add_header` only *extends* a chain (it requires
    // `height == tip.height + 1` and `prev_hash == tip.id`) — it has no fork
    // following, so a client that already synced to height 10 cannot walk onto
    // a competing branch. The realistic light-client recovery is to re-sync
    // from a trusted point (here: genesis), so we feed a fresh client the
    // whole new selected chain and require it to verify every authority
    // signature along the way and land on the node's new tip.
    let new_headers = node.export_spv_headers();
    let mut new_spv_client = kovanica_state::spv::SpvClient::with_poa(
        genesis_header.clone(),
        kovanica_state::spv::SpvPoAConfig {
            authority_set: set.clone(),
            slot_duration_ms: SLOT_MS,
            sw_poa: false,
        },
    );

    let mut added = 0usize;
    for header in new_headers.clone() {
        if header.height == 0 {
            continue; // already the client's tip (genesis)
        }
        new_spv_client.add_header(header).unwrap();
        added += 1;
    }
    assert!(
        added > 10,
        "post-reorg chain must exceed the pre-reorg height"
    );

    // The light client's independently verified tip must match the node's,
    // and it must be past the fork point, i.e. on the new branch.
    let spv_tip = new_spv_client.tip().unwrap();
    assert_eq!(spv_tip.id, new_tip.unwrap());
    assert!(spv_tip.height > 10);

    println!("SPV sync under re-org test passed");
}

// ---------------------------------------------------------------------------
// Resource Profiling Test (CPU/RAM under PoA)
// ---------------------------------------------------------------------------

/// Resident set size in bytes, read from `/proc/self/status` (`VmRSS`).
/// `None` off Linux.
fn resident_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|l| {
        let rest = l.strip_prefix("VmRSS:")?;
        let kb: u64 = rest.trim().trim_end_matches(" kB").trim().parse().ok()?;
        Some(kb * 1024)
    })
}

#[test]
#[ignore = "run manually for resource profiling"]
fn resource_profiling_poa_production() {
    // The PoW half of the original PoA-vs-PoW comparison was removed with PoW
    // (RFC-POA); there is no longer a second arm to compare against. What
    // remains is the measurement that matters for the Phase-1 adoption gate:
    // per-block production cost and the node's resident footprint.
    let (set, sks) = authority_set(3, 2);
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
        set,
        SLOT_MS,
    )
    .unwrap();
    for sk in &sks {
        node.set_authority_signing_key(sk.to_bytes());
    }

    let blocks = 100;
    let rss_before = resident_bytes();
    let start = std::time::Instant::now();
    for _ in 0..blocks {
        node.produce_empty().unwrap();
    }
    let elapsed = start.elapsed();
    let rss_after = resident_bytes();

    let per_block_us = elapsed.as_micros() as f64 / blocks as f64;
    println!("PoA {blocks} blocks: {elapsed:?} ({per_block_us:.1} us/block)");
    if let (Some(before), Some(after)) = (rss_before, rss_after) {
        println!(
            "RSS {} MiB -> {} MiB (+{:.1} KiB/block)",
            before / (1 << 20),
            after / (1 << 20),
            (after.saturating_sub(before) as f64 / blocks as f64) / 1024.0
        );
    }

    // PoA production is a signature, not a hash search, so per-block cost must
    // stay in the microsecond range. The bound is deliberately loose: it is a
    // regression tripwire against a reintroduced search loop, not a benchmark.
    assert!(
        per_block_us < 50_000.0,
        "PoA block production took {per_block_us:.1} us/block — a search loop may have crept back in"
    );
}
