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
//! These tests are **active regression gates** for the RFC-009 (B1) fix in
//! `Dag::compute_ghostdag`: once block pruning is enabled, the inherited
//! `blue_anticone_sizes` map is bounded to the pruning window by dropping keys
//! in `past(P)` (and any key the oracle can no longer resolve), which removes
//! the phantom-anticone mechanism above. The second and third tests are the
//! RFC-009 **R4 differential gate**: the same DAG built with pruning on and off
//! must agree on colouring and reachability for every non-final block, over a
//! DAG that contains merges *and* a retained `anticone(P)` block (the case that
//! makes the naive "strip evicted ids" repair unsound — see
//! `RFC-009-DESIGN-ANALYSIS.md` §3).
//!
//! ⚠️ **Known limitation (RFC-009 (B2), open).** Dropping `past(P)` keys is
//! provably sound for every candidate in `future(P) ∪ {P}`, but for a stale
//! candidate `S ∈ anticone(P)` that forked off `A ∈ past(P)` the chain blocks in
//! `past(P) \ past(A)` are genuinely in `S`'s anticone, so the drop can in
//! principle *under*-count there (the opposite direction from the F1 over-count).
//! The gate below exercises exactly that configuration and the (B1) map still
//! reproduces the unpruned colouring for it — but that is one construction, not a
//! proof. A finite `block_pruning_depth` therefore **stays disabled** network-wide
//! (RFC-009 R8) until (B2) is settled.

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

/// A longer DAG with the two features the R4 gate must cover:
///
/// * **merges** — `n = [c40, S]` and `m = [n, x]` are multi-parent blocks, so
///   `blue_score` and the linearized chain height genuinely differ; and
/// * a **retained `anticone(P)` block** — `S` forks off `c20`, so once the
///   pruning point `P` moves past `c20`, `S` is neither in `past(P)` nor a
///   descendant of `P`: `prune_old_blocks` retains it, which is precisely the
///   block that makes stripping `past(P)` keys unsound (design analysis §3).
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
    // A stale fork off a chain block *below* the pruning point. It is left as a
    // **dangling tip** until after the prune: if it were merged before the prune
    // it would become an ancestor of the pruning point and be evicted as
    // `past(P)`, which is not the case the R4 gate must cover. Forking off
    // `chain[34]` (with `P = c35` at depth 5) puts `S` in `anticone(P)` while
    // still being retained, because a dangling tip is never an ancestor of `P`.
    let s = add(&mut dag, &[chain[34]], "S");
    ids.push(("S".into(), s));
    if prune {
        dag.set_block_pruning_depth(depth);
    }
    // Inserting `x` is what triggers the prune (it runs at the end of an
    // insert). `S` is still a dangling tip here — not an ancestor of `P` — so it
    // is retained in `anticone(P)`: the (B2) case.
    let x = add(&mut dag, &[chain[40]], "x");
    ids.push(("x".into(), x));
    // Now merge the stale fork, which makes `S` a mergeset candidate coloured
    // against the pruned DAG — the F1 condition.
    // The pruning point in effect when `m` is coloured (captured before the
    // insert, since the prune runs at the end of every insert).
    let p_at_merge = dag.pruning_point();
    let m = add(&mut dag, &[x, s], "m");
    ids.push(("m".into(), m));
    if dag.in_anticone(&p_at_merge, &s) {
        ids.push(("S@anticoneP".into(), s));
    }
    // `S` is a mergeset candidate for `m` — this instant is the (B2) case the R4
    // gate must cover. Record that `S` was still present *now*: the prune runs at
    // the end of every insert, so once the follow-on blocks land `S` falls into
    // `past(P)` and is legitimately evicted, making an end-of-build check
    // impossible. The colouring that matters is stored in `m`'s `GhostdagData`,
    // which survives `S`'s eviction.
    if dag.contains(&s) {
        ids.push(("S@merge".into(), s));
    }
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
    // The gate is only meaningful if the DAG actually exercised the F1 case:
    // `S` must have been in the pruning point's anticone at the instant the
    // merging block `m` was coloured — the (B2) stale-candidate case. `S` is
    // legitimately evicted afterwards (the prune runs at the end of every
    // insert), so this is the merge-time marker captured in `build_rich`, not an
    // end-of-build containment check.
    assert!(
        ids_pru.iter().any(|(label, _)| label == "S@anticoneP"),
        "the anticone(P) block S was not in the pruning point's anticone when the \
         merging block was coloured; the R4 (B2) case is not covered"
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
