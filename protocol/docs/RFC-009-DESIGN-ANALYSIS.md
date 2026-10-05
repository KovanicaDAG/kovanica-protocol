# RFC-009 Design Analysis — the soundness precondition for block pruning

**Status:** Draft — design analysis (input to the RFC-009 R1-R8 implementation)
**Consensus impact:** consensus-critical (the analysis determines whether the fix is
a local repair or a consensus-rule change)
**Related:** [`RFC-009-BlockPruning-Colouring.md`](RFC-009-BlockPruning-Colouring.md)
(F1, the defect), [`RFC-009-FIX-BRIEF.md`](RFC-009-FIX-BRIEF.md) (R1-R8 execution brief),
[`RFC-008-OraclePruning.md`](RFC-008-OraclePruning.md) (corrected), `../TASKLIST2.md` §2.5
**Applies to:** `kovanica-dag` (`ghostdag.rs`, `dag.rs`, `reachability.rs`)

> This document records **why** the obvious fixes fail and what a sound one must
> satisfy. It does not prescribe the final implementation. Its purpose is to stop
> a fourth attempt at the local repair before it is written.

---

## 1. The question

R5 says: *`Dag::remove_blocks` must leave every surviving block's colouring state
consistent — either strip evicted ids and maintain a valid invariant, or make
colouring not consult historical ids at all.*

The "strip" half is the cheap option, so it is worth asking precisely: **when is
it sound to remove a key from a retained `blue_anticone_sizes` map?**

## 2. The precondition, stated exactly

A retained block `sp` carries `sp.ghostdag.blue_anticone_sizes`, whose keys are
the blocks in `sp`'s blue set. A future block `C` with selected parent `sp`
evaluates each mergeset candidate `c` against that map in
`try_colour_blue` (`crates/kovanica-dag/src/ghostdag.rs:105`):

```rust
for (&blue, &blue_size) in blue_anticone_sizes {
    if !self.in_anticone(&blue, candidate) { continue; }
    if anticone_blues.len() as KParam + 1 > k { return None; }
    if blue_size + 1 > k { return None; }
    anticone_blues.push(blue);
}
```

So a key `b` influences colouring **iff** `in_anticone(b, c)` is true for some
candidate `c`. Define:

> **`b` is inert for `c`** ⇔ `in_anticone(b, c)` is false ⇔ `b` is an ancestor of `c`
> or a descendant of `c`.

Removing `b` from the map is sound **iff `b` is inert for every candidate that can
ever be evaluated against that map**.

Candidates for `C` are the blocks in `C`'s mergeset, i.e. `past(C) \ (past(sp) ∪ {sp})`.
Equivalently: blocks that `C` references, that are not already in `sp`'s past.

## 3. What the current code guarantees — and what it does not

`Dag::pruning_point` (`crates/kovanica-dag/src/dag.rs:566-568`) documents the
insert-time invariant:

> *"When block pruning is enabled, every block in `past(P)` except genesis is (or
> will be) evicted, and **a new block's selected parent must be in
> `future(P) ∪ {P}`**."*

That is the **selected parent only**. It does not constrain the block's other
parents, and it does not constrain what is already retained. And
`prune_old_blocks` (`dag.rs:603`) evicts `past(P) \ past(P_old)` — it retains
every block in `future(P) ∪ {P} ∪ anticone(P)`.

**Consequence 1 — stripping `past(P)` is sound *only* for candidates in
`future(P) ∪ {P}`.** For `b ∈ past(P)` and `c ∈ future(P) ∪ {P}` we have
`b ∈ past(P) ⊆ past(c)`, so `b` is an ancestor of `c` and inert. Good.

**Consequence 2 — but `prune_old_blocks` retains `anticone(P)` blocks, and those
can be candidates.** For `b ∈ past(P)` and a retained `c ∈ anticone(P)`:

- `c` is not an ancestor of `b`, because `c ∉ past(P)` while `b ∈ past(P)`;
- so `in_anticone(b, c)` reduces to `!is_ancestor(b, c)` — which is **false only
  if `b` happens to be an ancestor of `c`**, and nothing guarantees that.

So there exist legitimate DAGs in which a stripped `b` genuinely participates in
some candidate's k-cluster. Stripping it **under-counts** `anticone_blues` and can
flip a genuinely-red candidate to blue — a divergence in the *opposite* direction
from F1, and just as fatal.

**Consequence 3 — evicting `anticone(P)` too does not rescue it.** If an
`anticone(P)` block `x` is evicted, it is still a key in the retained maps. Its
entry is now phantom (`is_ancestor` answers `false` both ways), which *over*-counts
— and stripping it instead *under*-counts for any candidate `c` where `x` is
genuinely in `anticone(c)` but not an ancestor of `c`. Neither direction is sound.

## 4. The earlier empirical result is consistent with this

The strip was implemented once (in `Dag::remove_blocks`, retaining only non-evicted
ids) and observed to:

- **restore the unpruned `blue_score`** for the differential repro block, but
- fire the load-bearing debug assert at `ghostdag.rs:77`
  (`blue_anticone_sizes.len() as u64 == blue_score`, observed `left: 6, right: 24`), and
- fail four existing pruning tests
  (`insert_rejects_builds_on_pruned_history`,
  `insert_with_block_pruning_automatically_prunes`, `pruning_point_moves_forward`,
  `snapshot_roundtrip_with_pruned_blocks`).

That is exactly what Consequence 2 predicts: the arithmetic is right for the
common case, but the retained-`anticone(P)` gap and the invariant make it wrong in
general.

## 5. What a sound design must establish

Either:

**(A) Make every retained block descend from `P`.** Then `past(P)` is a subset of
every retained block's past, every stripped key is inert, and the strip is sound.
This requires strengthening the insert-time rule from *"the selected parent is in
`future(P) ∪ {P}`"* to **"every parent is in `future(P) ∪ {P}`"** (by induction
that puts every retained block in `future(P) ∪ {P}`), plus evicting any remaining
`anticone(P)` blocks, plus deliberately replacing the `len == blue_score`
invariant.

> ⚠️ **This is a consensus-rule change.** A block whose non-selected parent lies in
> `anticone(P)` would be accepted today and rejected under (A). It therefore cannot
> land on a running chain without the reset, and it must be gated behind an
> activation height or the reset genesis — not flipped on silently.

**(B) Stop consulting the historical map.** Rework the k-cluster evaluation so a
candidate is judged against a bounded, recent structure (mergeset + a window
derived from the finality/pruning depth) rather than the full blue set. Then
eviction cannot corrupt colouring, because colouring never reads an evicted id.
This is the Kaspa-shaped answer and is the only option that keeps the acceptance
rule unchanged.

**(C) Make the oracle answer correctly for evicted ids.** Keep `P` as-is, but
retain enough reachability information for `past(P)` to answer
`is_ancestor(evicted, present) = true` (they are all ancestors of every
`future(P) ∪ {P}` block). This is sound *only* for `past(P)` — it does not help
`anticone(P)` — and it trades the O(N²) map for a compact "everything here is an
ancestor of everything retained" marker. It is a smaller change than (A) or (B)
but it must still solve the `anticone(P)` case, and it leaves the O(N²) map in
place, so it does not satisfy R1/R6 by itself.

## 6. Recommendation

**(B) is the only option that satisfies all of R1-R7 without changing which blocks
are accepted.** (A) is smaller and reuses the existing map, but it is a
consensus-rule change and it must be sequenced with the reset.

The R4 differential test — the same DAG built with pruning on and off, asserting
identical `is_ancestor`, `in_anticone`, `mergeset_ordered` and colouring for every
non-final block — is the gate for either. It must be run over DAGs **that contain
merges and a retained `anticone(P)` block**, because that is the case the current
`block_pruning_preserves_colouring` repro already exercises and the case that
distinguishes a sound fix from the strip.

## 7. What must not be re-attempted

Recorded so the work is not repeated a fourth time:

1. Dropping selected-chain ("spine") entries from `blue_anticone_sizes` — disproven;
   a spine ancestor of the selected parent need not be an ancestor of a mergeset
   candidate. Breaks `block_pruning::adversarial_wide_fork_pruning`.
2. Replay-time DAG eviction gated on the pass-1 `remaining` referrer counts —
   unsound for the reasons in §3 (a non-parent ancestor is still reachable through
   retained blue sets).
3. Stripping evicted ids from the retained maps — unsound in general per §3, and it
   violates the `ghostdag.rs:77` invariant.
