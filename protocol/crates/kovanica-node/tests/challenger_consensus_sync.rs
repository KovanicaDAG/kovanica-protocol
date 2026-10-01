//! Empirical Challenge Test Suite for Consensus Invariants, Wall-Clock Drift
//! Limits, and Reorg Locator Sync.
//!
//! The difficulty/retarget suites were removed with PoW (RFC-POA): there is no
//! difficulty window, so "clamp" and "oscillation" invariants no longer exist.
//! What remains is the PoA-relevant half: timestamp bounds, GHOSTDAG reorg
//! convergence, and SPV locator resolution.
//!
//! Authored by: challenger_2

use std::net::TcpListener;
use std::thread;
use std::time::Duration;

use kovanica_dag::BlockId;
use kovanica_node::relay::{handle_relay_query, RelayMsg, RelaySession};
use kovanica_node::{
    build_locator, sync_headers_via_relay, sync_headers_via_relay_with_clock, Node, NodeError,
};
use kovanica_state::spv::{BlockHeader as SpvHeader, SpvClient};

const MAX_FUTURE_DRIFT_MS: u64 = 2 * 60 * 60 * 1000; // 7,200,000 ms = 2h

fn genesis_header(work: u128, timestamp_ms: u64) -> SpvHeader {
    SpvHeader {
        id: BlockId::from_bytes([0x01; 32]),
        prev_hash: BlockId::from_bytes([0x00; 32]),
        merkle_root: [0x00; 32],
        work,
        timestamp_ms,
        nonce: 0,
        blue_score: 0,
        chain_blue_work: work,
        height: 0,
        authority_sig: None,
        authority_set_hash: [0u8; 32],
        hash_without_authority_sig: [0u8; 32],
    }
}

// ============================================================================
// 1. DIFFICULTY RETARGETING CLAMP EMPIRICAL CHALLENGES
// ============================================================================

// ============================================================================
// 2. WALL-CLOCK DRIFT LIMITS EMPIRICAL CHALLENGES
// ============================================================================

#[test]
fn test_wall_clock_drift_exact_boundary_on_node() {
    let now_ms = 5_000_000u64;
    let mut node = Node::new();
    node.set_now_ms(now_ms);
    node.genesis(3, 1000, 1000, 1, None).unwrap();

    let gen_id = node.genesis_id().unwrap();

    // 1. Exact boundary: now_ms + MAX_FUTURE_DRIFT_MS (7,200,000ms ahead)
    let block_at_limit = kovanica_node::BlockRecord {
        parents: vec![gen_id],
        work: 1,
        timestamp_ms: now_ms + MAX_FUTURE_DRIFT_MS,
        nonce: 0,
        authority_sig: None,
        txs: vec![],
    };
    let res_limit = node.receive_block(block_at_limit);
    assert!(
        res_limit.is_ok(),
        "Block at exact drift boundary must be accepted by node"
    );

    // 2. Off-by-1ms boundary: now_ms + MAX_FUTURE_DRIFT_MS + 1ms
    let block_exceeded = kovanica_node::BlockRecord {
        parents: vec![gen_id],
        work: 1,
        timestamp_ms: now_ms + MAX_FUTURE_DRIFT_MS + 1,
        nonce: 0,
        authority_sig: None,
        txs: vec![],
    };
    let res_exceeded = node.receive_block(block_exceeded);
    match res_exceeded {
        Err(NodeError::TimestampTooFarInFuture {
            timestamp_ms,
            now_ms: n_ms,
        }) => {
            assert_eq!(timestamp_ms, now_ms + MAX_FUTURE_DRIFT_MS + 1);
            assert_eq!(n_ms, now_ms);
        }
        other => panic!("Expected TimestampTooFarInFuture error, got {:?}", other),
    }

    // 3. Overflow safety: u64::MAX
    let block_overflow = kovanica_node::BlockRecord {
        parents: vec![gen_id],
        work: 1,
        timestamp_ms: u64::MAX,
        nonce: 0,
        authority_sig: None,
        txs: vec![],
    };
    assert!(matches!(
        node.receive_block(block_overflow),
        Err(NodeError::TimestampTooFarInFuture { .. })
    ));
}

#[test]
fn test_wall_clock_drift_exact_boundary_on_spv_tcp_relay() {
    let now_ms = 10_000_000u64;
    let g_hdr = genesis_header(1, now_ms);

    // Server serves 3 headers in sequence:
    // 1: now_ms + MAX_FUTURE_DRIFT_MS - 1 (accepted)
    // 2: now_ms + MAX_FUTURE_DRIFT_MS (exact boundary - accepted)
    // 3: now_ms + MAX_FUTURE_DRIFT_MS + 1 (exceeded by 1ms - rejected)
    let h1 = SpvHeader {
        id: BlockId::from_bytes([0x11; 32]),
        prev_hash: g_hdr.id,
        merkle_root: [0; 32],
        work: 1,
        timestamp_ms: now_ms + MAX_FUTURE_DRIFT_MS - 1,
        nonce: 0,
        blue_score: 1,
        chain_blue_work: 2,
        height: 1,
        authority_sig: None,
        authority_set_hash: [0u8; 32],
        hash_without_authority_sig: [0u8; 32],
    };
    let h2 = SpvHeader {
        id: BlockId::from_bytes([0x12; 32]),
        prev_hash: h1.id,
        merkle_root: [0; 32],
        work: 1,
        timestamp_ms: now_ms + MAX_FUTURE_DRIFT_MS,
        nonce: 0,
        blue_score: 2,
        chain_blue_work: 3,
        height: 2,
        authority_sig: None,
        authority_set_hash: [0u8; 32],
        hash_without_authority_sig: [0u8; 32],
    };
    let h3_bad = SpvHeader {
        id: BlockId::from_bytes([0x13; 32]),
        prev_hash: h2.id,
        merkle_root: [0; 32],
        work: 1,
        timestamp_ms: now_ms + MAX_FUTURE_DRIFT_MS + 1,
        nonce: 0,
        blue_score: 3,
        chain_blue_work: 4,
        height: 3,
        authority_sig: None,
        authority_set_hash: [0u8; 32],
        hash_without_authority_sig: [0u8; 32],
    };

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();

    let h1_c = h1.clone();
    let h2_c = h2.clone();
    let h3_c = h3_bad.clone();

    let server_handle = thread::spawn(move || {
        let mut server = RelaySession::accept(&listener).unwrap();
        server
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();

        // Round 1: Send h1 and h2
        let _ = server.recv().unwrap();
        server
            .send(&RelayMsg::Headers {
                headers: vec![h1_c, h2_c],
            })
            .unwrap();

        // Round 2: Send h3_bad
        let _ = server.recv().unwrap();
        server
            .send(&RelayMsg::Headers {
                headers: vec![h3_c],
            })
            .unwrap();
    });

    let mut client_session = RelaySession::connect(addr).unwrap();
    client_session
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();

    let mut spv_client = SpvClient::new(g_hdr);

    // Sync h1 and h2 (both within 2h)
    let sync1 =
        sync_headers_via_relay_with_clock(&mut client_session, &mut spv_client, None, Some(now_ms));
    assert_eq!(sync1.unwrap(), 2);
    assert_eq!(spv_client.tip().unwrap().height, 2);

    // Sync h3_bad (exceeds 2h by 1ms) -> must fail!
    let sync2 =
        sync_headers_via_relay_with_clock(&mut client_session, &mut spv_client, None, Some(now_ms));
    assert!(
        sync2.is_err(),
        "Sync must fail when header timestamp exceeds 2h drift"
    );

    server_handle.join().unwrap();
}

// ============================================================================
// 3. REORG LOCATOR SYNC & CONVERGENCE EMPIRICAL CHALLENGES
// ============================================================================

#[test]
fn test_locator_generation_structure_and_exponential_backoff() {
    let g_hdr = genesis_header(1, 1000);
    let mut client = SpvClient::new(g_hdr.clone());

    // Build chain of 100 headers
    let mut prev = g_hdr.clone();
    for h in 1..=100 {
        let hdr = SpvHeader {
            id: BlockId::from_bytes([h as u8; 32]),
            prev_hash: prev.id,
            merkle_root: [0; 32],
            work: 1,
            timestamp_ms: 1000 + h * 1000,
            nonce: 0,
            blue_score: h,
            chain_blue_work: (h + 1) as u128,
            height: h,
            authority_sig: None,
            authority_set_hash: [0u8; 32],
            hash_without_authority_sig: [0u8; 32],
        };
        client.add_header(hdr.clone()).unwrap();
        prev = hdr;
    }

    let locator = build_locator(&client);

    // Top 10 entries must be step 1 (heights: 100, 99, 98, 97, 96, 95, 94, 93, 92, 91)
    for (i, loc_id) in locator.iter().enumerate().take(10) {
        assert_eq!(*loc_id, BlockId::from_bytes([(100 - i) as u8; 32]));
    }

    // Step doubles:
    // 11th entry: step 2 -> height 91 - 2 = 89
    assert_eq!(locator[10], BlockId::from_bytes([89u8; 32]));
    // 12th entry: step 4 -> height 89 - 4 = 85
    assert_eq!(locator[11], BlockId::from_bytes([85u8; 32]));
    // 13th entry: step 8 -> height 85 - 8 = 77
    assert_eq!(locator[12], BlockId::from_bytes([77u8; 32]));
    // 14th entry: step 16 -> height 77 - 16 = 61
    assert_eq!(locator[13], BlockId::from_bytes([61u8; 32]));
    // 15th entry: step 32 -> height 61 - 32 = 29
    assert_eq!(locator[14], BlockId::from_bytes([29u8; 32]));
    // 16th entry: step 64 -> height 29 - 64 = 0 (genesis)
    assert_eq!(locator[15], g_hdr.id);

    // Final entry is always genesis
    assert_eq!(*locator.last().unwrap(), g_hdr.id);
}

#[test]
fn test_node_headers_from_deep_reorg_and_fork_convergence() {
    let mut node = Node::new();
    node.set_now_ms(1_000);
    node.genesis(3, 1000, 1000, 1, None).unwrap();

    let gen_id = node.genesis_id().unwrap();

    // 1. Build Branch A: 30 blocks
    let mut branch_a_ids = vec![gen_id];
    for i in 1..=30 {
        node.set_now_ms(1_000 + i * 1_000);
        let sent = node.send(1, 10 + i, 2).unwrap();
        branch_a_ids.push(sent.block);
    }

    let selected_tip_a = *node.tips().unwrap().first().unwrap();
    assert_eq!(selected_tip_a, *branch_a_ids.last().unwrap());

    // 2. Query headers_from with locator on Branch A:
    // A fully synced client with locator [tip_a, ...] gets 0 headers
    let synced_headers = node.headers_from(&[selected_tip_a], None, 100).unwrap();
    assert!(synced_headers.is_empty());

    // A client at height 15 on Branch A querying headers receives 16..=30 (15 headers)
    let partial_headers = node.headers_from(&[branch_a_ids[15]], None, 100).unwrap();
    assert_eq!(partial_headers.len(), 15);
    assert_eq!(partial_headers[0].id, branch_a_ids[16]);
    assert_eq!(partial_headers.last().unwrap().id, branch_a_ids[30]);

    // 3. Test stop_hash boundary:
    let stop_headers = node
        .headers_from(&[branch_a_ids[10]], Some(branch_a_ids[20]), 100)
        .unwrap();
    assert_eq!(stop_headers.len(), 10);
    assert_eq!(stop_headers[0].id, branch_a_ids[11]);
    assert_eq!(stop_headers.last().unwrap().id, branch_a_ids[20]);

    // 4. Test limit bounding:
    let limit_headers = node.headers_from(&[branch_a_ids[10]], None, 5).unwrap();
    assert_eq!(limit_headers.len(), 5);
    assert_eq!(limit_headers[0].id, branch_a_ids[11]);
    assert_eq!(limit_headers[4].id, branch_a_ids[15]);

    // 5. Test disjoint locator (unknown block ids):
    let disjoint_loc = vec![
        BlockId::from_bytes([0xEE; 32]),
        BlockId::from_bytes([0xFF; 32]),
    ];
    let fallback_headers = node.headers_from(&disjoint_loc, None, 10).unwrap();
    // Starts from index 0 (genesis)
    assert_eq!(fallback_headers.len(), 10);
    assert_eq!(fallback_headers[0].id, gen_id);
}

#[test]
fn test_spv_tcp_sync_across_node_reorg() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();

    let handle = thread::spawn(move || {
        let mut node = Node::new();
        node.set_now_ms(1_000);
        node.genesis(3, 1000, 1000, 1, None).unwrap();

        for i in 1..=10 {
            node.set_now_ms(1_000 + i * 1_000);
            let _ = node.send(1, 10 + i, 2).unwrap();
        }

        let mut server = RelaySession::accept(&listener).unwrap();
        server
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();

        // 1. Client syncs initial 10 blocks
        let req1 = server.recv().unwrap();
        let resp1 = handle_relay_query(&node, &req1).unwrap();
        server.send(&resp1).unwrap();

        // 2. Node produces 5 more blocks
        for i in 11..=15 {
            node.set_now_ms(1_000 + i * 1_000);
            let _ = node.send(1, 10 + i, 2).unwrap();
        }

        // 3. Client queries next batch
        let req2 = server.recv().unwrap();
        let resp2 = handle_relay_query(&node, &req2).unwrap();
        server.send(&resp2).unwrap();
    });

    let mut client_session = RelaySession::connect(addr).unwrap();
    client_session
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();

    let mut temp_node = Node::new();
    temp_node.set_now_ms(1_000);
    temp_node.genesis(3, 1000, 1000, 1, None).unwrap();
    let g_id = temp_node.genesis_id().unwrap();
    let g_hdr = temp_node.spv_header(&g_id).unwrap();

    let mut spv_client = SpvClient::new(g_hdr);

    // Initial sync
    let sync1 = sync_headers_via_relay(&mut client_session, &mut spv_client, None).unwrap();
    assert_eq!(sync1, 10);
    assert_eq!(spv_client.tip().unwrap().height, 10);

    // Incremental sync
    let sync2 = sync_headers_via_relay(&mut client_session, &mut spv_client, None).unwrap();
    assert_eq!(sync2, 5);
    assert_eq!(spv_client.tip().unwrap().height, 15);

    handle.join().unwrap();
}

#[test]
fn test_dag_competing_branch_reorg_and_locator_common_ancestor_resolution() {
    // 1. Full Node with GHOSTDAG consensus
    let mut node = Node::new();
    node.set_now_ms(1_000);
    node.genesis(3, 1000, 1000, 1, None).unwrap();
    let gen_id = node.genesis_id().unwrap();

    // 2. Build initial chain (Branch A) up to height 10
    let mut branch_a = vec![gen_id];
    for i in 1..=10 {
        node.set_now_ms(1_000 + i * 1_000);
        let sent = node.send(1, 10 + i, 2).unwrap();
        branch_a.push(sent.block);
    }
    assert_eq!(node.selected_tip().unwrap(), branch_a[10]);

    // 3. SPV Client syncs Branch A
    let g_hdr = node.spv_header(&gen_id).unwrap();
    let mut spv_client_a = SpvClient::new(g_hdr);
    for id in &branch_a[1..] {
        let hdr = node.spv_header(id).unwrap();
        spv_client_a.add_header(hdr).unwrap();
    }
    assert_eq!(spv_client_a.tip().unwrap().height, 10);
    assert_eq!(spv_client_a.tip().unwrap().id, branch_a[10]);

    // 4. Now create heavier competing Branch B splitting from Branch A at height 4 (branch_a[4])
    // We insert blocks directly into the DAG with higher work to force a GHOSTDAG reorg
    let split_ancestor = branch_a[4];
    let mut branch_b = vec![split_ancestor];
    let mut cur_parent = split_ancestor;

    for i in 1..=12 {
        let block_rec = kovanica_node::BlockRecord {
            parents: vec![cur_parent],
            work: 5, // Higher work per block to surpass Branch A
            timestamp_ms: 10_000 + i * 1_000,
            nonce: i,
            authority_sig: None,
            txs: vec![],
        };
        let b_id = node.receive_block(block_rec).unwrap();
        branch_b.push(b_id);
        cur_parent = b_id;
    }

    // Assert that the DAG indeed reorged to Branch B!
    let new_tip = node.selected_tip().unwrap();
    assert_eq!(new_tip, *branch_b.last().unwrap());
    assert_ne!(new_tip, branch_a[10]);

    // 5. Query full node with SPV Client A's locator (built on the orphaned Branch A)
    let locator_a = build_locator(&spv_client_a);
    let reorg_headers = node.headers_from(&locator_a, None, 100).unwrap();

    // The common ancestor is branch_a[4] (height 4).
    // The returned headers must start from branch_b[1] (height 5 along Branch B) up to the tip of Branch B!
    assert_eq!(reorg_headers.len(), 12);
    assert_eq!(reorg_headers[0].id, branch_b[1]);
    assert_eq!(reorg_headers[0].height, 5);
    assert_eq!(reorg_headers.last().unwrap().id, *branch_b.last().unwrap());
    assert_eq!(reorg_headers.last().unwrap().height, 16);
}

#[test]
fn test_large_chain_locator_bound() {
    let g_hdr = genesis_header(1, 1000);
    let mut client = SpvClient::new(g_hdr.clone());

    let mut prev = g_hdr;
    for h in 1..=5_000 {
        let hdr = SpvHeader {
            id: BlockId::from_bytes([(h % 255 + 1) as u8; 32]),
            prev_hash: prev.id,
            merkle_root: [0; 32],
            work: 1,
            timestamp_ms: 1000 + h * 1000,
            nonce: 0,
            blue_score: h,
            chain_blue_work: (h + 1) as u128,
            height: h,
            authority_sig: None,
            authority_set_hash: [0u8; 32],
            hash_without_authority_sig: [0u8; 32],
        };
        client.add_header(hdr.clone()).unwrap();
        prev = hdr;
    }

    let locator = build_locator(&client);
    // For 5000 blocks: 10 direct + log2(5000) ~ 13 => total length ~ 23
    assert!(locator.len() <= 30);
    assert!(locator.len() >= 20);
    // First 10 are consecutive
    for (i, loc_id) in locator.iter().enumerate().take(10) {
        assert_eq!(*loc_id, client.header(5000 - i as u64).unwrap().id);
    }
    // Last entry is genesis
    assert_eq!(*locator.last().unwrap(), client.header(0).unwrap().id);
}
