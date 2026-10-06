//! RFC-009 **R6** — the retained GHOSTDAG colouring state must be bounded by the
//! block-pruning window, not by the chain length.
//!
//! Before RFC-009, each block's `blue_anticone_sizes` map held one entry per blue
//! block in its full historical blue set, so a DAG of `N` blocks retained O(N²)
//! colouring entries — ~461 KB/block at N=11,776, extrapolating to tens of GB on
//! the real log. The map is now **sparse** (RFC-009 R6): it stores only the
//! entries the block itself sets or bumps, so per-block state is O(k) regardless
//! of depth or chain length. This test pins the key consequence: **growing the
//! chain while holding the pruning depth fixed does not grow the retained
//! colouring state at all**, and the per-block map stays O(k).

use kovanica_dag::{Block, BlockId, Dag};

fn new_dag(k: u16) -> (Dag, BlockId) {
    let genesis = Block::genesis(1, 0, 0, b"kovanica-genesis".to_vec());
    let id = genesis.id();
    (Dag::new(k, genesis), id)
}

fn add(dag: &mut Dag, parents: &[BlockId], label: &str) -> BlockId {
    dag.insert(Block::new(
        parents.to_vec(),
        1,
        0,
        0,
        label.as_bytes().to_vec(),
    ))
    .unwrap_or_else(|e| panic!("insert {label} failed: {e:?}"))
}

/// Build a chain of `chain_len` blocks with a side fork merged every 4 steps
/// (so the DAG has real mergesets), enabling pruning at `depth` once the chain is
/// long enough. Returns `(retained_blocks, total_map_entries, max_map_entries)`.
fn measure(chain_len: usize, depth: u64) -> (usize, u64, u64) {
    let (mut dag, genesis) = new_dag(3);
    let mut ids = vec![genesis];
    for i in 1..=chain_len {
        if i == 5 {
            dag.set_block_pruning_depth(depth);
        }
        let parent = *ids.last().unwrap();
        let mut parents = vec![parent];
        if i % 4 == 0 && ids.len() >= 2 {
            let side = add(&mut dag, &[parent], &format!("s{i}"));
            parents.push(side);
            ids.push(side);
        }
        let c = add(&mut dag, &parents, &format!("c{i}"));
        ids.push(c);
    }

    let retained: Vec<BlockId> = ids.iter().copied().filter(|id| dag.contains(id)).collect();
    let mut total = 0u64;
    let mut max = 0u64;
    for id in &retained {
        let m = dag.ghostdag(id).unwrap().blue_anticone_sizes.len() as u64;
        total += m;
        max = max.max(m);
    }
    (retained.len(), total, max)
}

#[test]
fn retained_colouring_state_is_bounded_by_pruning_depth_not_chain_length() {
    let depth = 20;
    let (r_small, t_small, m_small) = measure(200, depth);
    let (r_large, t_large, m_large) = measure(4000, depth);

    // 20× the chain length, byte-for-byte the same retained colouring state.
    assert_eq!(
        (r_small, t_small, m_small),
        (r_large, t_large, m_large),
        "retained colouring state grew with chain length: \
         N=200 -> {r_small} blocks / {t_small} entries / max {m_small}; \
         N=4000 -> {r_large} blocks / {t_large} entries / max {m_large}"
    );

    // The number of retained blocks is bounded by the pruning window (not the
    // 4000-block chain), and — with the sparse map (RFC-009 R6) — the per-block
    // map is O(k), independent of both the window and the chain.
    assert!(
        r_large as u64 <= depth + 2,
        "retained blocks {r_large} exceed the pruning window {depth}"
    );
    assert!(
        m_large <= 8,
        "per-block colouring map {m_large} is not O(k) (k=3): the sparse map regressed"
    );
}

#[test]
fn retained_colouring_state_grows_with_pruning_depth() {
    // Sanity check that the bound tracks `depth` (and is not trivially zero):
    // deeper windows retain more blocks, but the total is ~O(k × depth) with the
    // sparse map, never O(N²).
    let (r5, t5, _) = measure(2000, 5);
    let (r80, t80, _) = measure(2000, 80);
    assert!(r80 > r5, "deeper pruning must retain more blocks");
    assert!(t80 > t5, "deeper pruning must retain more colouring state");
    // Linear-ish in depth now (sparse map): t80 / t5 ≈ 80/5 = 16, under 400.
    assert!(
        t80 <= t5 * 400,
        "colouring state grew faster than the pruning window: t5={t5}, t80={t80}"
    );
}
