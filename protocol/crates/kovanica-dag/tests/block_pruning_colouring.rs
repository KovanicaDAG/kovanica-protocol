//! Block-pruning consistency: evicting blocks must not change the GHOSTDAG
//! colouring of any block inserted afterwards.
//!
//! `Dag::remove_blocks` drops evicted ids from the reachability oracle,
//! `nodes`, and `tips` — but it does **not** strip them from the
//! `blue_anticone_sizes` maps retained on live blocks
//! (`GhostdagData.blue_anticone_sizes`). `try_colour_blue` iterates *every*
//! key in that map and asks `Dag::in_anticone(&blue, candidate)`, which is
//! computed from `Reachability::is_ancestor`. For an evicted id both
//! `is_ancestor(evicted, x)` and `is_ancestor(x, evicted)` are `false`, so
//! `in_anticone` returns `true` even when the evicted block is a *true
//! ancestor* of the candidate.
//!
//! Consequence: after any eviction, every mergeset candidate whose colouring
//! is evaluated sees O(|past(P)|) phantom anticone blues and is forced red,
//! diverging from an unpruned node's `blue_score` / `mergeset_blues`.
//!
//! This test currently FAILS (see TASKLIST2 §2.5). It is `#[ignore]`d so the
//! suite stays green while the bug is open; remove the `#[ignore]` once fixed.

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
    .expect("insert should succeed")
}

/// Build chain `c1..=c20`, side block `S` on `c18`, `n = [c20, S]`, then `x`
/// forking the tip and finally `m = [n, x]`.
///
/// With `prune = true` the block pruning depth is set to 3 before `x` is
/// inserted, so the prune runs at the end of `x`'s insert and `m`'s colouring
/// is computed against the pruned DAG. With `prune = false` no eviction
/// happens and `m`'s colouring is the reference.
fn build(prune: bool) -> (Dag, BlockId) {
    let (mut dag, genesis) = new_dag(3);
    let mut prev = genesis;
    let mut chain = Vec::new();
    for i in 1..=20 {
        let id = add(&mut dag, &[prev], &format!("c{i}"));
        chain.push(id);
        prev = id;
    }
    let c20 = *chain.last().unwrap();
    let c18 = chain[17];
    let s = add(&mut dag, &[c18], "S");
    let n = add(&mut dag, &[c20, s], "n");
    if prune {
        dag.set_block_pruning_depth(3);
    }
    let x = add(&mut dag, &[c20], "x");
    let m = add(&mut dag, &[n, x], "m");
    (dag, m)
}

#[test]
#[ignore = "F1 open: block pruning corrupts later GHOSTDAG colouring (TASKLIST2 §2.5)"]
fn block_pruning_preserves_colouring() {
    let (dag_ref, m_ref) = build(false);
    let (dag_pru, m_pru) = build(true);

    let g_ref = dag_ref.ghostdag(&m_ref).unwrap();
    let g_pru = dag_pru.ghostdag(&m_pru).unwrap();

    assert_eq!(
        g_ref.blue_score,
        g_pru.blue_score,
        "eviction changed the later merging block's blue_score \
         (ref blues={} reds={}, pruned blues={} reds={})",
        g_ref.mergeset_blues.len(),
        g_ref.mergeset_reds.len(),
        g_pru.mergeset_blues.len(),
        g_pru.mergeset_reds.len(),
    );
    assert_eq!(
        g_ref.mergeset_blues, g_pru.mergeset_blues,
        "eviction changed which blocks were coloured blue"
    );
}
