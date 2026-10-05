//! Block-pruning **eviction** correctness (RFC-009 §12).
//!
//! `Dag::prune_old_blocks` evicts `past(P) \ {genesis}` by walking the selected
//! chain down from the pruning point `P`, collecting each chain block's mergeset
//! and then the chain block itself. `Reachability::remove_blocks` then drops the
//! evicted ids from the oracle and re-parents their present tree-children to
//! genesis. Two latent bugs lived in that path; both are reachable only once a
//! finite `block_pruning_depth` is set, so both are regression-gated here:
//!
//! 1. **Genesis eviction** (`genesis_is_never_evicted`). The mergeset of a chain
//!    block `c` was computed via `mergeset_ordered(sp, c.parents())` *before*
//!    checking whether `sp` was already evicted. With an evicted `sp` the oracle
//!    cannot answer `is_ancestor(genesis, sp)`, so genesis was misclassified as a
//!    merge candidate and evicted. The next insert then panicked walking
//!    `subtree_size` up to the (now absent) root — `reachability.rs`
//!    `expect("ancestor sized")`.
//!
//! 2. **Non-downward-closed eviction after a selected-chain reorg**
//!    (`eviction_is_downward_closed_across_a_reorg`). The walk stopped at the
//!    evicted `sp` *before* collecting `c`'s mergeset, so a present block
//!    `A ∈ past(evicted X)` survived. That left a dangling future-covering-set
//!    reference `X ∈ fcs[A]`, which panicked a later insert — `reachability.rs`
//!    `insert_to_future_covering_set` indexing `intervals[X]`.
//!
//! The fix is two-part and lives in `kovanica-dag/src/dag.rs`:
//!
//! * `mergeset_ordered` now treats **genesis** as an unconditional boundary
//!   (`x == self.genesis`), which the oracle can no longer confirm once `sp` is
//!   evicted; and
//! * `prune_old_blocks` always collects `c`'s mergeset *before* the
//!   already-evicted-`sp` check, so off-chain ancestors like `A` are evicted with
//!   `X` and the evicted set stays downward-closed.
//!
//! Both tests build the same DAG with pruning off (reference) and on, and check
//! the retained blocks against the reference: colouring and reachability must be
//! identical, and the evicted set must be downward-closed (the only retained
//! ancestor of an evicted block is genesis). The reference build is what makes
//! the downward-closure check possible — `Dag::is_ancestor` cannot see evicted
//! blocks.

use kovanica_dag::{Block, BlockId, Dag};

fn new_dag(k: u16) -> (Dag, BlockId) {
    let genesis = Block::genesis(1, 0, 0, b"kovanica-genesis".to_vec());
    let id = genesis.id();
    (Dag::new(k, genesis), id)
}

/// Insert `n` blocks described by `cs` (parent *indices* into
/// `[genesis, b0, b1, …]`). When `prune` is set, `set_block_pruning_depth(depth)`
/// is called immediately before the `prune_at`-th insert, so the prune runs at
/// the end of that insert. Stops at the first rejected insert (e.g.
/// `BuildsOnPrunedHistory`) and returns the ids inserted so far, genesis first.
fn build(
    k: u16,
    cs: &[Vec<usize>],
    prune: bool,
    depth: u64,
    prune_at: usize,
) -> (Dag, Vec<BlockId>) {
    let (mut dag, genesis) = new_dag(k);
    let mut ids = vec![genesis];
    for (i, parents) in cs.iter().enumerate() {
        if prune && i == prune_at {
            dag.set_block_pruning_depth(depth);
        }
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids[p]).collect();
        match dag.insert(Block::new(ps, 1, 0, 0, format!("b{i}").into_bytes())) {
            Ok(id) => ids.push(id),
            Err(_) => break,
        }
    }
    (dag, ids)
}

/// The evicted set must be **downward-closed** (ancestor-closed): the only
/// retained ancestor of an evicted block may be genesis. Otherwise a retained
/// block's future-covering set can reference an evicted block and the oracle is
/// left inconsistent. The reference build identifies the evicted blocks —
/// `Dag::is_ancestor` in the pruned DAG cannot see them.
///
/// Note the direction: retained blocks are *not* ancestor-closed (a retained
/// `anticone(P)` block legitimately has evicted ancestors in `past(P)`); it is
/// the *evicted* set that is ancestor-closed.
fn assert_downward_closed(ref_dag: &Dag, ref_ids: &[BlockId], pru: &Dag) {
    let genesis = ref_ids[0];
    for x in ref_ids.iter().filter(|id| !pru.contains(id)) {
        for a in ref_ids.iter().filter(|id| pru.contains(id)) {
            if ref_dag.is_ancestor(a, x) {
                assert_eq!(
                    *a, genesis,
                    "evicted block has a retained non-genesis ancestor: eviction \
                     is not downward-closed (ancestor={a:?}, evicted={x:?})"
                );
            }
        }
    }
}

/// The two colourings and the two reachability answers for every retained block
/// must match the unpruned reference.
fn assert_matches_reference(ref_dag: &Dag, ref_ids: &[BlockId], pru: &Dag, pru_ids: &[BlockId]) {
    let retained: Vec<BlockId> = pru_ids
        .iter()
        .copied()
        .filter(|id| pru.contains(id))
        .collect();
    for id in &retained {
        let r = ref_dag.ghostdag(id).expect("reference colouring");
        let p = pru.ghostdag(id).expect("pruned colouring");
        assert_eq!(r.blue_score, p.blue_score, "{id:?}: blue_score diverged");
        assert_eq!(r.blue_work, p.blue_work, "{id:?}: blue_work diverged");
        assert_eq!(
            r.selected_parent, p.selected_parent,
            "{id:?}: selected_parent diverged"
        );
        assert_eq!(
            r.mergeset_blues, p.mergeset_blues,
            "{id:?}: mergeset_blues diverged"
        );
        assert_eq!(
            r.mergeset_reds, p.mergeset_reds,
            "{id:?}: mergeset_reds diverged"
        );
    }
    for a in &retained {
        for b in &retained {
            assert_eq!(
                ref_dag.is_ancestor(a, b),
                pru.is_ancestor(a, b),
                "is_ancestor({a:?}, {b:?}) diverged under pruning"
            );
        }
    }
    assert!(!retained.is_empty(), "no retained block was compared");
    // `ref_ids` and `pru_ids` are content-addressed: the pruned build is a prefix
    // of the reference build.
    assert!(pru_ids.len() <= ref_ids.len());
    for (i, id) in pru_ids.iter().enumerate() {
        assert_eq!(&ref_ids[i], id, "block id mismatch at index {i}");
    }
}

/// Bug 1: genesis must never be evicted. Before the fix the insert at `i=9`
/// panicked (`ancestor sized`); afterwards `i=8` had already evicted genesis.
#[test]
fn genesis_is_never_evicted() {
    // k=2, depth 4, pruning enabled immediately before `b7`.
    let cs: Vec<Vec<usize>> = vec![
        vec![0],
        vec![0],
        vec![0, 1, 2],
        vec![2, 3, 1],
        vec![3, 0, 4],
        vec![0, 5],
        vec![6, 1],
        vec![5],
        vec![4],
        vec![7, 4],
    ];
    let (mut dag, genesis) = new_dag(2);
    let mut ids = vec![genesis];
    for (i, parents) in cs.iter().enumerate() {
        if i == 7 {
            dag.set_block_pruning_depth(4);
        }
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids[p]).collect();
        let id = dag
            .insert(Block::new(ps, 1, 0, 0, format!("b{i}").into_bytes()))
            .expect("pruning must not reject or panic on this DAG");
        ids.push(id);
    }
    assert!(dag.contains(&genesis), "genesis was evicted");
    assert_ne!(
        dag.pruning_point(),
        genesis,
        "pruning never advanced, test is vacuous"
    );

    let (ref_dag, ref_ids) = build(2, &cs, false, 0, 0);
    assert_downward_closed(&ref_dag, &ref_ids, &dag);
    assert_matches_reference(&ref_dag, &ref_ids, &dag, &ids);
}

/// Bug 2: after the selected chain reorgs onto a branch that forked below the
/// previous pruning point, eviction must still be downward-closed. Before the
/// fix, `b5` was evicted while its present ancestor `b4` survived, and a later
/// insert panicked indexing `intervals[b5]`.
#[test]
fn eviction_is_downward_closed_across_a_reorg() {
    // k=1, depth 3, pruning enabled immediately before `b11`. The selected tip
    // switches from the `b2/b3/b6/b10` branch to the `b5/b7/b8/b9` branch, so the
    // pruning point jumps across selected chains.
    let cs: Vec<Vec<usize>> = vec![
        vec![0],
        vec![1],
        vec![1, 2],
        vec![2, 3],
        vec![0],
        vec![1, 2, 5],
        vec![4, 5],
        vec![5, 6],
        vec![8],
        vec![4, 9],
        vec![5, 7],
        vec![8, 9, 11],
        vec![7, 8, 10],
        vec![10, 12, 13],
        vec![10, 13],
        vec![10, 11, 14],
    ];
    let (mut dag, genesis) = new_dag(1);
    let mut ids = vec![genesis];
    for (i, parents) in cs.iter().enumerate() {
        if i == 11 {
            dag.set_block_pruning_depth(3);
        }
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids[p]).collect();
        let id = dag
            .insert(Block::new(ps, 1, 0, 0, format!("b{i}").into_bytes()))
            .expect("pruning must not reject or panic on this DAG");
        ids.push(id);
    }
    assert!(dag.contains(&genesis), "genesis was evicted");
    assert_eq!(ids.len(), cs.len() + 1, "not every block was inserted");

    let (ref_dag, ref_ids) = build(1, &cs, false, 0, 0);
    assert_downward_closed(&ref_dag, &ref_ids, &dag);
    assert_matches_reference(&ref_dag, &ref_ids, &dag, &ids);
}
