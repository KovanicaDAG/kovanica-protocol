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
//! ## The RFC-009 fix: (A) + (B1)
//!
//! Two pieces, together:
//!
//! * **(B1)** — once block pruning is enabled, `Dag::compute_ghostdag` bounds
//!   the inherited `blue_anticone_sizes` map by dropping every key in
//!   `past(P)` (and any key the oracle can no longer resolve). This removes the
//!   phantom-anticone mechanism above.
//! * **(A+)** — `insert` rejects any block that has a parent **or a mergeset
//!   candidate** outside `future(P) ∪ {P}` (`DagError::BuildsOnPrunedHistory`).
//!   This makes (B1) *exact*: for a candidate in `future(P) ∪ {P}` every blue in
//!   `past(P)` is an ancestor (hence inert in `try_colour_blue`), so dropping
//!   those keys cannot change any colouring. The parent-only check is **not**
//!   enough — an `anticone(P)` block can be an ancestor of a `future(P)` parent
//!   and still surface as a candidate; the candidate check is the tight
//!   condition. Without it a retained `anticone(P)` candidate can be merged and
//!   (B1) under-counts — the confirmed counterexample of
//!   `RFC-009-DESIGN-ANALYSIS.md` §13, and the 344/8000 divergences of §14.
//!
//! The second and third tests below are the RFC-009 **R4 differential gate**:
//! the same DAG built with pruning on and off must agree on colouring and
//! reachability for every non-final block, over a DAG that contains a genuine
//! multi-parent merge. The fourth and fifth tests pin down the (A) rejection
//! rule itself.
//!
//! A finite `block_pruning_depth` nevertheless **stays disabled** network-wide
//! (RFC-009 R8) until R1-R7 all hold and the full differential gate is green.

use kovanica_dag::{Block, BlockId, Dag, DagError};

fn new_dag(k: u16) -> (Dag, BlockId) {
    let genesis = Block::genesis(1, 0, 0, b"kovanica-genesis".to_vec());
    let id = genesis.id();
    (Dag::new(k, genesis), id)
}

fn add(dag: &mut Dag, parents: &[BlockId], label: &str) -> BlockId {
    try_add(dag, parents, label).expect("insert should succeed")
}

/// Insert one block, returning its id or the rejection error.
fn try_add(dag: &mut Dag, parents: &[BlockId], label: &str) -> Result<BlockId, DagError> {
    dag.insert(Block::new(
        parents.to_vec(),
        1,
        0,
        0,
        label.as_bytes().to_vec(),
    ))
}

/// Build chain `c1..=c20`, side block `S` on `c18`, `n = [c20, S]`, then `x`
/// forking the tip and finally `m = [n, x]`.
///
/// With `prune = true` the block pruning depth is set to 3 before `x` is
/// inserted, so the prune runs at the end of `x`'s insert and `m`'s colouring
/// is computed against the pruned DAG. With `prune = false` no eviction
/// happens and `m`'s colouring is the reference. `n` is inserted before the
/// prune and `m` merges only `future(P)` blocks, so the build is (A)-compliant.
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

/// A longer (A)-compliant DAG for the R4 differential gate:
///
/// * a **genuine multi-parent merge** — `m = [x, S2]`, where `S2` forks off a
///   chain block at/above the pruning point, so `m`'s mergeset is non-empty and
///   its colouring exercises `try_colour_blue`; and
/// * a **retained `anticone(P)` block** — `S` forks off `chain[34]`, below the
///   pruning point, so once `P` moves past `c34` the tip `S` is retained but
///   lies in `anticone(P)`. Design (A) forbids merging it, which is asserted
///   separately in `pruning_rejects_merging_a_retained_anticone_block`.
///
/// Returns the DAG plus every id it inserted, so the caller can compare the
/// blocks the two variants have in common (`Dag` exposes no iterator over
/// block ids).
fn build_rich(prune: bool, depth: u64) -> (Dag, Vec<(String, BlockId)>) {
    let (mut dag, genesis) = new_dag(3);
    let mut ids: Vec<(String, BlockId)> = Vec::new();
    let mut chain = vec![genesis];
    for i in 1..=40 {
        let id = add(&mut dag, &[chain[i - 1]], &format!("c{i}"));
        ids.push((format!("c{i}"), id));
        chain.push(id);
    }
    // `S` forks off a chain block *below* the pruning point. It is left as a
    // dangling tip (never merged): after the prune it is retained in
    // `anticone(P)`, and (A) forbids merging it.
    let s = add(&mut dag, &[chain[34]], "S");
    ids.push(("S".into(), s));
    // `S2` forks off `chain[36]`, at/above the pruning point, so it stays in
    // `future(P)` and remains mergeable. It is the off-chain parent of `m`.
    let s2 = add(&mut dag, &[chain[36]], "S2");
    ids.push(("S2".into(), s2));
    if prune {
        dag.set_block_pruning_depth(depth);
    }
    // Inserting `x` triggers the prune (it runs at the end of an insert).
    let x = add(&mut dag, &[chain[40]], "x");
    ids.push(("x".into(), x));
    // An (A)-compliant multi-parent merge: both parents are in `future(P)`.
    let m = add(&mut dag, &[x, s2], "m");
    ids.push(("m".into(), m));
    let mut prev = m;
    for i in 0..5 {
        let id = add(&mut dag, &[prev], &format!("p{i}"));
        ids.push((format!("p{i}"), id));
        prev = id;
    }
    (dag, ids)
}

#[test]
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

/// RFC-009 **R4** (colouring half): the same DAG built with pruning on and off
/// must produce identical GHOSTDAG colouring for every block the pruned DAG
/// still retains.
///
/// `blue_anticone_sizes` is deliberately *not* compared: under pruning it
/// legitimately holds fewer keys, so comparing it would fail by construction.
/// The compared fields are the consensus-visible ones.
#[test]
fn block_pruning_preserves_colouring_for_every_retained_block() {
    let (dag_ref, ids) = build_rich(false, 0);
    let (dag_pru, ids_pru) = build_rich(true, 5);

    let mut compared = 0usize;
    for (label, id) in &ids {
        // Evicted blocks have no colouring left to compare; R4 is stated over
        // the blocks a pruning node still holds.
        if !dag_pru.contains(id) {
            continue;
        }
        assert!(
            dag_ref.contains(id),
            "{label}: missing from the unpruned DAG"
        );

        let r = dag_ref.ghostdag(id).expect("reference colouring");
        let p = dag_pru.ghostdag(id).expect("pruned colouring");

        assert_eq!(r.blue_score, p.blue_score, "{label}: blue_score diverged");
        assert_eq!(r.blue_work, p.blue_work, "{label}: blue_work diverged");
        assert_eq!(
            r.selected_parent, p.selected_parent,
            "{label}: selected_parent diverged"
        );
        assert_eq!(
            r.mergeset_blues, p.mergeset_blues,
            "{label}: mergeset_blues diverged"
        );
        assert_eq!(
            r.mergeset_reds, p.mergeset_reds,
            "{label}: mergeset_reds diverged"
        );
        compared += 1;
    }

    assert!(compared > 0, "no retained block was compared");
    // The gate is only meaningful if the DAG actually exercised a merge against
    // the pruned DAG; `m` is the (A)-compliant multi-parent block.
    assert!(
        ids_pru.iter().any(|(label, _)| label == "m"),
        "the merging block m was not inserted; the differential gate is vacuous"
    );
}

/// RFC-009 **R4** (reachability half): pruning must not change `is_ancestor`
/// or `in_anticone` between any two blocks the pruned DAG still retains.
#[test]
fn block_pruning_preserves_reachability_for_retained_blocks() {
    let (dag_ref, ids) = build_rich(false, 0);
    let (dag_pru, _) = build_rich(true, 5);

    let retained: Vec<&(String, BlockId)> =
        ids.iter().filter(|(_, id)| dag_pru.contains(id)).collect();

    for (la, a) in &retained {
        for (lb, b) in &retained {
            assert_eq!(
                dag_ref.is_ancestor(a, b),
                dag_pru.is_ancestor(a, b),
                "is_ancestor({la}, {lb}) diverged under pruning"
            );
            assert_eq!(
                dag_ref.in_anticone(a, b),
                dag_pru.in_anticone(a, b),
                "in_anticone({la}, {lb}) diverged under pruning"
            );
        }
    }
}

/// RFC-009 design **(A)**: a block whose parent lies in `anticone(P)` — a stale
/// fork retained by the pruning window but not a descendant of the pruning
/// point — is rejected with `BuildsOnPrunedHistory`, *even though the parent is
/// still present*. This is what keeps every mergeset candidate inside
/// `future(P) ∪ {P}`, which is what makes the bounded (B1) colouring map exact.
#[test]
fn pruning_rejects_merging_a_retained_anticone_block() {
    let (mut dag, genesis) = new_dag(3);
    let mut chain = vec![genesis];
    for i in 1..=40 {
        chain.push(add(&mut dag, &[chain[i - 1]], &format!("c{i}")));
    }
    let s = add(&mut dag, &[chain[34]], "S");
    dag.set_block_pruning_depth(5);
    let x = add(&mut dag, &[chain[40]], "x");

    let p = dag.pruning_point();
    assert!(dag.contains(&s), "S must be retained (a dangling tip)");
    assert!(
        dag.in_anticone(&p, &s),
        "S must lie in the pruning point's anticone"
    );

    let err = try_add(&mut dag, &[x, s], "m")
        .expect_err("merging a retained anticone(P) block must be rejected");
    assert!(
        matches!(err, DagError::BuildsOnPrunedHistory { .. }),
        "expected BuildsOnPrunedHistory, got {err:?}"
    );
}

/// RFC-009 §13 counterexample, now closed by design (A).
///
/// The `b0..b7` construction is the minimal DAG where design (B1)'s bounded map
/// diverges from an unpruned node *if* an `anticone(P)` block (`b4`) is allowed
/// to be merged: the reference colours `b4` **red** in `b7`'s mergeset
/// (`b7.blue_score == 7`, `mergeset_blues = 0`), while (B1) alone colours it
/// **blue** (`blue_score == 8`). Design (A) rejects the merging block `b7` (its
/// parent `b4` forks off the evicted `b1`) with `BuildsOnPrunedHistory`, so the
/// divergent colouring is never computed.
#[test]
fn design_a_rejects_the_section_13_counterexample() {
    // Parent indices into a genesis-first id list.
    let script: [&[usize]; 8] = [
        &[0],    // b0
        &[1],    // b1
        &[1],    // b2
        &[1, 3], // b3  (pruning enabled just before this insert)
        &[1, 2], // b4  (forks off b1; ends up in anticone(P))
        &[2, 4], // b5
        &[4, 6], // b6
        &[5, 7], // b7  (merges b4 ∈ anticone(P) → rejected by (A))
    ];

    // Reference: no pruning, every block accepted; `b4` is red in `b7`'s mergeset.
    let (mut dag_ref, genesis) = new_dag(3);
    let mut ids = vec![genesis];
    for (i, parents) in script.iter().enumerate() {
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids[p]).collect();
        ids.push(add(&mut dag_ref, &ps, &format!("b{i}")));
    }
    let b7_ref = dag_ref.ghostdag(&ids[8]).expect("reference colouring");
    assert_eq!(b7_ref.blue_score, 7, "reference b7 blue_score changed");
    assert_eq!(
        b7_ref.mergeset_blues.len(),
        0,
        "reference must colour b4 red in b7's mergeset"
    );

    // Pruned: the same script must be rejected at `b7` by design (A).
    let (mut dag_pru, genesis) = new_dag(3);
    let mut ids_pru = vec![genesis];
    let mut rejection = None;
    for (i, parents) in script.iter().enumerate() {
        if i == 3 {
            dag_pru.set_block_pruning_depth(3);
        }
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids_pru[p]).collect();
        match try_add(&mut dag_pru, &ps, &format!("b{i}")) {
            Ok(id) => ids_pru.push(id),
            Err(e) => {
                rejection = Some((i, e));
                break;
            }
        }
    }

    let (i, err) = rejection.expect("design (A) must reject the counterexample merge");
    assert_eq!(i, 7, "the block that merges b4 ∈ anticone(P) is b7");
    assert!(
        matches!(err, DagError::BuildsOnPrunedHistory { .. }),
        "expected BuildsOnPrunedHistory, got {err:?}"
    );
}

/// RFC-009 §14: design (A)'s *parent-only* check is **not** sufficient.
///
/// Every parent in this 25-block script lies in `future(P) ∪ {P}`, yet `b17`
/// merges a block that has an `anticone(P)` ancestor, so `b17`'s mergeset
/// contains an `anticone(P)` candidate. With the parent-only (A) check and the
/// bounded (B1) map, that candidate is under-counted and coloured blue where an
/// unpruned node colours it red (`ref blue_score = 11`, pruned `= 12`). A
/// differential search over (A)-compliant DAGs found 344/8000 such divergences;
/// adding the candidate check (design (A+)) drove it to 0/8000.
///
/// This script is seed 25 of that search. The (A+) check rejects the block that
/// would introduce the `anticone(P)` candidate, and every block accepted before
/// the rejection matches the unpruned reference exactly.
#[test]
fn design_a_plus_rejects_a_merge_with_an_anticone_p_ancestor() {
    let script: [&[usize]; 25] = [
        &[0],
        &[0, 1],
        &[1, 2],
        &[0, 2],
        &[1],
        &[0, 4],
        &[1, 3],
        &[5],
        &[1],
        &[2, 6, 9],
        &[4, 6],
        &[4, 6],
        &[10, 12],
        &[6],
        &[10, 13],
        &[10],
        &[16],
        &[10, 15, 17],
        &[18],
        &[18, 19],
        &[20],
        &[18, 19],
        &[20, 21, 22],
        &[20, 23],
        &[23, 24],
    ];

    // Reference: full build, no pruning — b17 is blue_score 11.
    let (mut dag_ref, genesis) = new_dag(3);
    let mut ids_ref = vec![genesis];
    for (i, parents) in script.iter().enumerate() {
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids_ref[p]).collect();
        ids_ref.push(add(&mut dag_ref, &ps, &format!("b{i}")));
    }
    assert_eq!(
        dag_ref.ghostdag(&ids_ref[18]).unwrap().blue_score,
        11,
        "reference b17 blue_score changed"
    );

    // Pruned (depth 3): (A+) must reject the anticone(P)-ancestor merge.
    let (mut dag_pru, genesis) = new_dag(3);
    dag_pru.set_block_pruning_depth(3);
    let mut ids_pru = vec![genesis];
    let mut rejected_at = None;
    for (i, parents) in script.iter().enumerate() {
        let ps: Vec<BlockId> = parents.iter().map(|&p| ids_pru[p]).collect();
        match try_add(&mut dag_pru, &ps, &format!("b{i}")) {
            Ok(id) => ids_pru.push(id),
            Err(DagError::BuildsOnPrunedHistory { .. }) => {
                rejected_at = Some(i);
                break;
            }
            Err(e) => panic!("unexpected error at b{i}: {e:?}"),
        }
    }
    assert!(
        rejected_at.is_some(),
        "design (A+) must reject a merge whose mergeset has an anticone(P) candidate"
    );

    // Every block accepted before the rejection matches the reference.
    for (i, id) in ids_pru.iter().enumerate().skip(1) {
        if !dag_pru.contains(id) {
            continue; // evicted by pruning — nothing to compare
        }
        let r = dag_ref.ghostdag(id).unwrap();
        let p = dag_pru.ghostdag(id).unwrap();
        assert_eq!(r.blue_score, p.blue_score, "b{} blue_score diverged", i - 1);
        assert_eq!(
            r.mergeset_blues,
            p.mergeset_blues,
            "b{} mergeset_blues diverged",
            i - 1
        );
        assert_eq!(
            r.mergeset_reds,
            p.mergeset_reds,
            "b{} mergeset_reds diverged",
            i - 1
        );
    }
}
