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

## 8. Empirical result: a retained `anticone(P)` block really can be a candidate

A throwaway probe built chain `c1..=c40`, `S = [c20]`, set the block-pruning depth to
3, inserted `x = [c40]` to trigger the prune, then inserted `z = [c40, S]` — making the
retained stale block `S` a **non-selected parent**, i.e. a mergeset candidate. It
inserted successfully:

```
PROBE s_retained=true x_present=true dag.len()=6
PROBE is_ancestor(p,S)=false is_ancestor(S,p)=false in_anticone(p,S)=true
PROBE z inserted: blue_score=41 blues=[] reds=1 s_is_blue=false
```

So the residual case in §3 is not hypothetical: `S` survives the prune, lies in
`anticone(P)`, and is evaluated as a candidate. A `b ∈ past(P)` map key is therefore
**not guaranteed inert**, and stripping it can under-count and flip a genuinely-red
candidate to blue — divergence in the opposite direction from F1.

Two corollaries:

- **Option (A) is definitively a consensus-rule change.** Making every retained block
  descend from `P` means requiring every *parent* (not just the selected parent) to be
  in `future(P) ∪ {P}`; that rejects `z`, which the current code accepts. It can only
  land behind an activation height or at the reset genesis.
- **Option (B) cannot assume every retained block descends from `P`** — it must handle
  the stale-candidate case explicitly.

## 9. Which (blue, candidate) pairs are actually at risk

Writing `sp` for the new block's selected parent and `c` for a mergeset candidate
(`c ∈ past(C) \ past(sp)`), a map key `b ∈ past(sp)` is read for `c` iff
`in_anticone(b, c)`, i.e. iff `b` is neither an ancestor nor a descendant of `c`.

- If `c ∈ future(P) ∪ {P}` and `b ∈ past(P)`, then `past(P) ⊆ past(c)`, so `b` is an
  ancestor of `c`: **inert**. Safe to drop.
- If `c ∈ anticone(P)` and `b ∈ future(P) ∩ past(sp)`, then `b` is above `P` and `c` is
  not a descendant of `P`; both directions can be false: **live**.
- If `c ∈ anticone(P)` and `b ∈ past(P)`: live unless `c` happens to descend from `b`.

So the risk set is exactly **(blues in `past(P)`) × (candidates in `anticone(P)`)**, plus
the recent window. That is why a bound that keeps only the recent window
(`future(P) ∩ past(sp)`, size ~`block_pruning_depth`) satisfies R1/R6 for the common
case but is **not** acceptance-neutral unless stale candidates are handled explicitly.

### Why the tempting shortcut is not sound

The obvious stale-candidate rule — "if `c ∈ anticone(P)`, it is red anyway, because
`past(P) \ past(c)` contributes at least `k` blues to its anticone" — does **not** hold in
general. Let `A` be the deepest common ancestor of `P` and `c`; then
`past(P) ∩ past(c) ⊆ past(A)`, so the count is at least
`P.blue_score − A.blue_score`. A stale candidate that forks off immediately below `P`
(`A = selected_parent(P)`) gives a bound of 1 — well under `k = 3`. Under-counting there
can colour a genuinely-red candidate blue. The shortcut is therefore unsound, and the
stale-candidate case needs its own sound rule (or the retained set must be restricted so
that case cannot arise — which is option (A), a rule change).

## 10. Consequence for the chosen design

Design (B) (do not consult the historical map; bound the colouring state to the
finality/pruning window) remains the right target because it is the only shape that
satisfies R1 and R6 without changing which blocks are accepted. But §8-§9 pin down what
it must still solve, and that is a genuine design question, not an implementation detail:

1. A bounded structure over `future(P) ∩ past(sp)` handles every candidate in
   `future(P) ∪ {P}` exactly (R2), because `past(P)` keys are provably inert there.
2. The residual `anticone(P)` candidates must be evaluated without the historical map,
   and the naive "always red" rule is unsound (§9). Any replacement rule must be proven
   to reproduce the unpruned colouring for every such candidate — which is precisely what
   the R4 gate exercises (`build_rich` keeps `S = [c20]` as a retained stale block and
   colours `m` and five follow-on blocks after the prune).
3. If no sound, acceptance-neutral rule for (2) is found, the honest options are to
   restrict the retained set so the case cannot arise (option (A) — a consensus-rule
   change, gated behind the reset or an activation height) or to keep the historical map
   for stale candidates only (which does not satisfy R1/R6).

The R4 gate is the arbiter: it must be un-ignored and green before any finite
`block_pruning_depth` is re-enabled (R8), and it must keep covering a retained
`anticone(P)` candidate.

## 11. Empirical result: a stale candidate is genuinely blue unpruned, and the
divergence is not confined to `anticone(P)`

A second throwaway probe (chain `c1..=c40`; `S` forking off `c37`/`c38`/`c39`;
`set_block_pruning_depth(3)`; `x = [c40]` triggers the prune; then `z = [c40, S]`
so `S` is a mergeset candidate) settles the open question from §9:

```
fork_at=c37  s_retained=true in_anticone(P,S)=true   len_ref=44 len_pru=7
   ref: z.blue_score=42  s_blue=true   blues=1 reds=0
   pru: z.blue_score=41  s_blue=false  blues=0 reds=1
fork_at=c38  s_retained=true in_anticone(P,S)=false  len_ref=44 len_pru=7
   ref: z.blue_score=42  s_blue=true   blues=1 reds=0
   pru: z.blue_score=41  s_blue=false  blues=0 reds=1
fork_at=c39  s_retained=true in_anticone(P,S)=false  len_ref=44 len_pru=7
   ref: z.blue_score=42  s_blue=false  blues=1 reds=0
   pru: z.blue_score=41  s_blue=false  blues=0 reds=1
```

Three consequences, each of which constrains design (B):

1. **The "a stale candidate is red anyway" shortcut is wrong.** At `fork_at=c37`
   and `c38` the retained stale block `S` is genuinely **blue** in the unpruned
   DAG (`s_blue=true`, `z.blue_score=42`, `blues=1`). Design (B) must evaluate
   stale candidates **exactly**; it cannot declare them red.
2. **Pruning flips a genuinely-blue candidate to red in all three cases**
   (`s_blue=false`, `z.blue_score=41`, `blues=0 reds=1`) — the phantom-anticone
   *over*-count direction of F1, reproduced at three different fork positions,
   not just in the single-block minimal repro.
3. **The divergence is not confined to `anticone(P)` candidates.** At
   `fork_at=c38`/`c39`, `in_anticone(P,S)=false` — i.e. `S ∈ future(P) ∪ {P}` —
   and the colouring *still* diverges. The mechanism is that evicted `past(P)`
   ids remain as keys in `sp`'s map and `in_anticone(evicted, S)` returns a
   phantom `true`, so a blue that is a true **ancestor** of `S` is counted as
   being in `S`'s anticone.

Consequence 3 is important for the design: for candidates in `future(P) ∪ {P}`
the evicted `past(P)` keys are provably inert (§9) and must simply be **dropped**
— which the current code does not do. So design (B) has two separable
sub-problems:

- **(B1) candidates in `future(P) ∪ {P}`** — drop every key that the oracle can
  no longer resolve; these are provably inert here, so the colouring is exact.
  This alone fixes the `fork_at=c38`/`c39` divergence.
- **(B2) candidates in `anticone(P)`** — `S` at `fork_at=c37`. Here a `past(P)`
  key may be genuinely live, so (B1)'s drop is not sound (§9), and a replacement
  rule must be proven to reproduce the unpruned colouring. If no such
  acceptance-neutral rule exists, the retained set must be restricted so the case
  cannot arise (option (A), gated behind the reset or an activation height).

The R4 gate must therefore keep two cases distinct and cover both: a candidate in
`future(P)` (the `build_rich` `m` path) and a retained `anticone(P)` candidate
(the `build_rich` `S = [c20]` path). Both are currently failing, which is the
correct state until (B1) and (B2) land.

## 12. Second eviction bug: `Reachability::remove_blocks` leaves the tree inconsistent

A differential search over randomly generated DAGs (1-3 parents per block drawn
from a recent window, so merges, stale forks and stale-on-stale are all
possible; several `k` values and prune depths) found a **second, independent
bug in the same family as F1 — but a hard panic rather than a silent colouring
divergence.**

### Symptom

```
thread 'b2_search_wide' panicked at crates/kovanica-dag/src/reachability.rs:232:44:
ancestor sized
```

That line is inside `Reachability::register_leaf`, in the walk that increments
`subtree_size` along the `tree_parent` chain upward from a new block's
`selected_parent`:

```rust
let mut cur = Some(selected_parent);
while let Some(x) = cur {
    *self.subtree_size.get_mut(&x).expect("ancestor sized") += 1;
    cur = self.tree_parent.get(&x).copied();
}
```

The panic means some ancestor on that chain has **no `subtree_size` entry** —
i.e. the walk passes *through* a node that was already removed.

### It is eviction-triggered, and it is not a construction artefact

- With the build loop instrumented, the **unpruned** build completed every
  insert; the **pruned** build panicked on the first insert after the prune.
  The captured failing construction is `k = 2`, `depth = 4`, panicking at
  iteration `i = 7`.
- `set_block_pruning_depth(depth)` runs `prune_old_blocks()` **immediately**,
  before that iteration's `dag.insert`. So the prune evicts blocks and the
  *very next insert* panics: the eviction leaves the tree inconsistent.
- The probe's DAG script is valid: parent indices are drawn only from strictly
  earlier slots, are deduped, and can never be the block itself or a later
  block. So this is not an invalid-DAG artefact.

### Mechanism

`Reachability::remove_blocks` (`reachability.rs:288-336`) collects the present
tree-children of evicted blocks and rewrites `tree_parent[child] = genesis` for
them, then removes the evicted ids from `intervals`, `fcs`, `tree_children`,
`tree_parent`, `subtree_size` and `next_free`, and finally subtracts
`evicted.len()` from `subtree_size[genesis]`. Two gaps are visible by
inspection and need confirmation against a minimal repro:

1. The re-parent is **one level deep** — it only rewrites the direct present
   children of evicted blocks. Any chain that was already inconsistent, or a
   child that was itself evicted in the same set and whose own child was not
   captured because `tree_children[evicted]` no longer listed it, leaves a
   `tree_parent` link pointing at a removed node.
2. Re-parented children are pushed onto genesis's `tree_children` **without
   de-duplication** against children already listed there (which can happen when
   a node is re-parented more than once across successive prunes).

Either way the invariant `subtree_size` must hold for every node reachable via
`tree_parent` from any retained block is violated after eviction.

### Impact

A **liveness / DoS bug on any node with block pruning enabled**: an ordinary
DAG containing merges is enough to trip it. It is not exposed on the current
network only because block pruning is disabled network-wide
(`BLOCK_PRUNING_DEPTH = u64::MAX`) per RFC-009 R8 — the same mitigation that
covers F1. It is a second, independent reason that a finite
`block_pruning_depth` must not be re-enabled until R5 (sound eviction) is
actually satisfied.

### Status and next steps

Not yet reduced to a minimal deterministic repro. The captured parameters are
`k = 2`, `n = 10`, `prune_at = 7`, `depth = 4`; isolating it needs the fixed
parent script for that construction dumped, then a small fixed DAG written as a
permanent regression test alongside `crates/kovanica-dag/tests/block_pruning_colouring.rs`.
Until then this section records the finding and its evidence, not a fix.

Cross-references: F1 (section 3), RFC-009 R5 (sound eviction) and R8 (load paths
guarded), and `crates/kovanica-dag/tests/block_pruning_colouring.rs`.
