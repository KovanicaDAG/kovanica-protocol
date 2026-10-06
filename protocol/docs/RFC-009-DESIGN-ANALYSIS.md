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

That line is inside `Reachability::add_block`, in the walk that increments
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

- The **unpruned** build completed every insert; the **pruned** build panicked
  on a later insert. The reduced construction is `k = 2`, `depth = 4`, with
  `set_block_pruning_depth(4)` called before the `b7` insert; the panic is at
  the `b9` insert.
- `Dag::set_block_pruning_depth` only stores the depth; the prune runs at the
  **end of the next insert**. So the prune that breaks the tree happens at the
  end of one insert, and a later insert exposes it: the eviction leaves the tree
  inconsistent.
- The probe's DAG script is valid: parent indices are drawn only from strictly
  earlier slots, are deduped, and can never be the block itself or a later
  block. So this is not an invalid-DAG artefact.

### Two distinct root causes, both fixed

The original hypotheses (one-level re-parenting; missing de-duplication) were
**not** the cause. The reduced repro pinned it down to `Dag::prune_old_blocks`:

1. **Genesis could be evicted.** The walk computed each chain block `c`'s
   mergeset via `mergeset_ordered(sp, c.parents())`, where
   `sp = selected_parent(c)` might already be evicted. `mergeset_ordered`
   treated `x ∈ past(sp)` as a boundary using `is_ancestor(x, sp)`, but once
   `sp` is evicted the oracle can no longer answer `is_ancestor(genesis, sp)`
   (its interval is gone), so **genesis was misclassified as a merge candidate**
   and inserted into the evicted set. `Reachability::remove_blocks` then deleted
   genesis's `subtree_size`, and the next insert's upward walk hit the missing
   root: `ancestor sized`.
2. **Eviction was not downward-closed after a selected-chain reorg.** The first
   fix attempt broke out of the walk as soon as `sp` was evicted, *before*
   collecting `c`'s mergeset. When the selected tip reorgs onto a branch that
   forked below the previous pruning point, the chain block `c` just above the
   evicted region can be present while its mergeset (present blocks merged from
   off the old selected chain) is also present. Skipping that mergeset left a
   present ancestor `A ∈ past(evicted X)` unevicted — a dangling
   future-covering-set reference `X ∈ fcs[A]`, which panicked a later insert at
   `insert_to_future_covering_set` indexing `intervals[X]`.

### The fix (`crates/kovanica-dag/src/dag.rs`)

- `mergeset_ordered` now treats **genesis** as an unconditional boundary
  (`x == self.genesis`), because the oracle cannot confirm it once `sp` is
  evicted. This is a no-op while pruning is disabled (genesis always resolves
  through the oracle then).
- `prune_old_blocks` always collects `c`'s mergeset **before** checking whether
  `sp` is already evicted, and stops only after the eviction set is complete.
  This keeps the evicted set downward-closed (ancestor-closed except genesis),
  which restores every invariant `Reachability::remove_blocks` relies on: no
  dangling `fcs` references, correct one-level re-parenting of present children
  to genesis, and `subtree_size[genesis] -= evicted.len()`.

### Regression coverage

`crates/kovanica-dag/tests/block_pruning_eviction.rs` builds both reduced DAGs
(the `k = 2` genesis-eviction case and the reorg case) with pruning off
(reference) and on, and asserts: genesis is never evicted, eviction is
downward-closed, and the retained blocks' colouring and reachability match the
unpruned reference.

### Impact

A **liveness / DoS bug on any node with block pruning enabled**: an ordinary
DAG containing merges is enough to trip it. It is not exposed on the current
network only because block pruning is disabled network-wide
(`BLOCK_PRUNING_DEPTH = u64::MAX`) per RFC-009 R8 — the same mitigation that
covers F1. It is a second, independent reason that a finite
`block_pruning_depth` must not be re-enabled until R5 (sound eviction) is
actually satisfied.

Cross-references: F1 (section 3), RFC-009 R5 (sound eviction) and R8 (load paths
guarded), `crates/kovanica-dag/tests/block_pruning_eviction.rs`, and
`crates/kovanica-dag/tests/block_pruning_colouring.rs`.

## 13. Confirmed counterexample: design (B1) is unsound at every depth

The earlier narrow differential sweep (sections 4 and 11) found (B1)
divergence-free for `depth >= 3` and concluded the residual risk was confined to
`depth == 2`. A **wider** sweep — stale-on-stale forks, multiple merges, wider
mergesets, and a random parent-window/parent-count per case — refutes that:

| family | k | depth | cases | divergences |
|---|---|---|---|---|
| narrow (section 4) | 3 | 2–6 | 1695 | 891 |
| narrow (section 4) | 3 | 3–10 | 1965 | 0 |
| wide | 1, 2, 3 | 2–8 | 36000 | 1141 |
| wide | 3 | 2–8 | 12000 | **707** |

and, per depth, for `k = 3`:

| depth | divergences |
|---|---|
| 3 | 238 / 2400 |
| 4 | 260 / 2400 |
| 5 | 133 / 2400 |
| 6 | 68 / 2400 |
| 8 | 8 / 2400 |

**There is no safe finite depth**: k=3 diverges at every depth tested. The rate
falls with depth but never reaches zero. Every divergence has the same
direction — the **pruned** `blue_score` is *higher* than the reference — i.e.
(B1) under-counts a candidate's blue anticone and colours a block blue that must
be red. No panics were observed (the section 12 eviction fix holds across 48000
cases).

### Minimal reproduction (k=3, depth=3, pruning enabled before `b3`)

```
b0:[0] b1:[1] b2:[1] b3:[1,3] b4:[1,2] b5:[2,4]
b6:[4,6] b7:[5,7]                        (indices into [genesis, b0, …])
```

Only `b0..b7` are needed. The incremental prunes evict `b1` at the end of
`b5`'s insert, `b3` at the end of `b6`'s, and `{b2, b4}` at the end of `b7`'s —
so `b7`'s colouring is computed against a DAG that has already lost `b1` and
`b3`. `b4` forks off the evicted `b1`; block `b7` (selected parent `b6`) merges
`b4`:

| block | sp (ref) | blue_score ref/pruned | mergeset blues ref/pruned | reds ref/pruned |
|---|---|---|---|---|
| b4 | b1 (evicted) | 3 / 3 | 0 / 0 | 0 / 0 |
| b5 | b3 | 5 / 5 | 1 / 1 | 0 / 0 |
| b6 | b5 | 6 / 6 | 0 / 0 | 0 / 0 |
| **b7** | **b6** | **7 / 8** | **0 / 1** | **1 / 0** |

`b4` is **red** in the reference and **blue** in the pruned build. (An earlier
draft listed `b8`/`b9` as well; they cannot be inserted because their parents
are evicted — the divergence is already present at `b7`.)

### Mechanism

`try_colour_blue` (`crates/kovanica-dag/src/ghostdag.rs`) iterates over the
**keys** of `blue_anticone_sizes` and applies the k-cluster rule to each:

```rust
for (&blue, &blue_size) in blue_anticone_sizes {
    if !self.in_anticone(&blue, candidate) { continue; }
    if anticone_blues.len() + 1 > k { return None; }
    if blue_size + 1 > k { return None; }
    anticone_blues.push(blue);
}
```

Correctness needs the map to contain **every blue block that can be in the
candidate's anticone**. (B1) drops every key in `past(P)`. For a candidate
`c ∈ future(P) ∪ {P}` that is inert — `past(P) ⊆ past(c)`. But for a retained
stale candidate `c ∈ anticone(P)`, a dropped key `b ∈ past(P)` can be in `c`'s
anticone. Here `b2, b3 ∈ past(P)` are both in `b4`'s anticone; dropping them
removes the conflict that made `b4` red (a blue block `b` with
`blue_size + 1 > k`). The candidate is then wrongly coloured blue, and the error
propagates into `b7`'s `blue_score` and beyond.

This is exactly the open (B2) case, now realised: `anticone(P)` candidates are
not inert, so a bounded map cannot be produced by *dropping* `past(P)` keys.
Dropping fewer keys (a smaller bound) would eventually keep the whole map and
lose the bound; dropping more would break `future(P)` candidates.

### Consequence for the design

(B1) cannot be repaired by tuning the retained set — the counterexample is
structural. The remaining options are:

- **(A) Forbid `anticone(P)` candidates**: strengthen the insert rule from
  "selected parent ∈ `future(P) ∪ {P}`" to "**every** parent ∈
  `future(P) ∪ {P}`". Then no post-pruning block can merge a stale
  `anticone(P)` block, so its (bounded) colouring is never consulted. This
  **rejects blocks the current code accepts**, i.e. a consensus-rule change,
  gated behind a reset or an activation height.
- **(C) A different bounded-colouring design** that does not rely on dropped
  keys being inert (e.g. a red-set/checkpoint scheme).

Until one is proven, **block pruning stays disabled** (`BLOCK_PRUNING_DEPTH =
u64::MAX`, R8) — now with a concrete counterexample rather than an open question.

Reproduction: `crates/kovanica-dag/tests/block_pruning_colouring.rs` — the R4
gate plus `design_a_rejects_the_section_13_counterexample` and
`design_a_plus_rejects_a_merge_with_an_anticone_p_ancestor`.

## 14. Design (A) is not enough: the tight condition is (A+)

### The gap in (A)

Design (A) as first proposed required **every parent** of a new block to lie in
`future(P) ∪ {P}`. That is necessary but *not* sufficient. A mergeset candidate
need not be a parent: it can be an **ancestor of a parent**. If a block `A` is in
`future(P)` but descends from a stale `anticone(P)` block `c`, then a new block
`B` with parent `A` has `c ∈ past(B)`. As long as `c ∉ past(sp(B))`, `c` is a
mergeset candidate of `B` — and `c ∈ anticone(P)` is exactly the dangerous case
of §13. So (A) can accept a block whose mergeset still contains an
`anticone(P)` candidate.

### The decisive experiment

A differential search over **random DAGs that satisfy (A)** (every parent drawn
from `future(P) ∪ {P}`), rebuilt pruned (depth 3, k=3, n=25) and unpruned, and
compared block-by-block:

| insert rule | cases | divergences |
|---|---|---|
| (A) every parent ∈ `future(P) ∪ {P}` | 8000 | **344** |
| (A+) every candidate ∈ `future(P) ∪ {P}` | 8000 | **0** |

The first divergence under (A) is `seed 25`, at `b17` (`ref blue_score = 11`,
pruned `= 12`) — a `future(P)`-parent block whose mergeset reaches an
`anticone(P)` ancestor.

### The tight condition (necessary and sufficient)

`(B1)`'s drop is exact **iff every mergeset candidate of `B` lies in
`future(P) ∪ {P}`** — equivalently, `B` has no retained ancestor in
`anticone(P)`, i.e. `past(B) \ past(P) ⊆ future(P) ∪ {P}`.

*Sufficiency:* for a candidate `c ∈ future(P) ∪ {P}` and any blue
`b ∈ past(P)`, `P ∈ past(c)` and `b ∈ past(P)`, so `b ∈ past(c)`; `b` is an
ancestor of `c`, hence inert in `try_colour_blue`. Dropping `b`'s key cannot
change `c`'s colour.
*Necessity:* §13 — an `anticone(P)` candidate has a genuine `past(P)` blue in its
anticone, and the drop under-counts it.

### Implementation

`Dag::insert_with_id_inner` computes the candidate set (`mergeset_blues ∪
mergeset_reds`, derived from `mergeset_ordered` and independent of the (B1)
trim) before the pruning check, so the check is direct:

```rust
if !skip_pruning_check && self.block_pruning_depth != u64::MAX {
    let p = self.pruning_point();
    for parent in block.parents() {
        if *parent != p && !self.is_ancestor(&p, parent) {
            return Err(DagError::BuildsOnPrunedHistory { id });
        }
    }
    for c in ghostdag.mergeset_blues.iter().chain(&ghostdag.mergeset_reds) {
        if *c != p && !self.is_ancestor(&p, c) {
            return Err(DagError::BuildsOnPrunedHistory { id });
        }
    }
}
```

The parent loop pins the selected parent (which is never itself a candidate) to
`future(P) ∪ {P}`; the candidate loop enforces the tight condition. Together with
(B1) this makes the bounded map exact for every accepted block.

### Status

The rule is enforced in `insert`; `insert_for_replay` bypasses it (replay is
trusted history, R8). A finite `block_pruning_depth` nevertheless **stays
disabled** network-wide until R7 (rejection equivalence) is established and the
full differential gate is green — the evidence above is a finite search, not a
proof. (A+) is a consensus-rule change (it rejects blocks the current code
accepts), so it needs a reset or activation-height gate before pruning is
re-enabled.

## 15. R6 (memory bound) and R7 (rejection equivalence)

### R6 — retained colouring state is bounded by the pruning window

With (B1)+(A+) the per-block map is *exact*. The R6 question is whether the
*retained* state is bounded by the pruning depth rather than the chain length.
`crates/kovanica-dag/tests/rfc009_memory_bound.rs` measures it directly (retained
blocks, total `blue_anticone_sizes` entries, max per-block map) on a chain with a
side fork merged every four steps.

At depth 50 the result is **identical for every chain length**:

| N (chain length) | retained | total entries | max map |
|---|---|---|---|
| 100 | 52 | 2601 | 51 |
| 400 | 52 | 2601 | 51 |
| 1600 | 52 | 2601 | 51 |
| 6400 | 52 | 2601 | 51 |

So the retained colouring state is a function of the pruning depth, not of the
chain length — the O(N) per-block map that made the brief's ~461 KB/block
estimate is gone. Scaling in the depth (chain, width 1):

| depth | retained | total | max map |
|---|---|---|---|
| 5 | 7 | 36 | 6 |
| 10 | 12 | 121 | 11 |
| 20 | 22 | 441 | 21 |
| 40 | 42 | 1681 | 41 |
| 80 | 82 | 6561 | 81 |
| 160 | 162 | 25921 | 161 |

i.e. `retained ≈ depth`, `max map ≈ depth`, and `total ≈ depth²`. Widening the
DAG keeps `max map ≈ depth` and grows the retained set only slowly (depth 50:
width 2 → 52/2601/51, width 8 → 68/3384/54). The essential requirement — the
per-block map is O(D) not O(N), and the total is bounded by the pruning window —
holds. The exact shape is `O(D²)` for a chain-like DAG because O(D) live blocks
each retain an O(D) map; a strict `O(D × width)` *total* would need a Kaspa-style
sparse map (each block storing only the `k × mergeset` entries it affects). That
is a memory optimisation, not a soundness requirement, and is left as follow-up.

### R7 — pruning and non-pruning nodes accept the same blocks

The ledger's live-admission finality check originally tested **only the selected
parent** (`parent_score < finality_score && sp != genesis`). The DAG's pruning
rejection, however, fires for **any** parent (evicted ⇒ `MissingParent`; present
but outside `future(P) ∪ {P}` ⇒ `BuildsOnPrunedHistory`). A block that merges a
final/evicted block, or an `anticone(P)` block, was therefore accepted by a
non-pruning node and rejected by a pruning node. A differential search over
20000 seeds diverged on **every** seed.

The fix has two parts:

1. **Ledger delta pruning survives eviction.** `reconstruct_state` walked the
   selected-parent chain through `Dag::ghostdag`, which returns `None` for an
   evicted block; and `prune()` skipped evicted blocks (their `ghostdag` is
   `None`), so their deltas leaked. The ledger now keeps its own
   `selected_parents: HashMap<BlockId, BlockId>` (set at insert, re-anchored when
   a delta is composed into its child in `prune_one`), `reconstruct_state` walks
   that map, `prune()` treats an evicted block as stale, and `prune_one` orders
   by the eviction-independent block height.
2. **The (A+) predicate is evaluated at admission on both node roles.** After the
   selected-parent check, the ledger computes the finality point
   (`Dag::lowest_block_at_or_above(finality_score)`, shared with
   `Dag::pruning_point`) and rejects a block when **any parent or mergeset
   candidate** is neither the point nor a descendant of it:

```rust
if !self.replay_mode {
    let finality_point = self.dag.lowest_block_at_or_above(finality_score);
    if finality_point != self.dag.genesis() {
        for x in block.parents().iter().chain(preview.mergeset.iter()) {
            if *x != finality_point && !self.dag.is_ancestor(&finality_point, x) {
                return Err(LedgerInsertError::Finality { parent_score, finality_score });
            }
        }
    }
}
```

The rule is a **consensus rule**, not a pruning optimisation: every node must
evaluate it, anchored at `finality_score`. Block-pruning eviction is only the
memory optimisation, and it is safe only when the pruning point coincides with or
is deeper than the finality point — hence the ledger clamps
`block_pruning_depth >= finality_depth`. After the fix the differential search
reports **0 / 20000** divergences, and the permanent
`crates/kovanica-state/tests/rfc009_rejection_equivalence.rs` covers both the
canonical configuration (eviction depth == finality depth) and an eviction depth
deeper than finality.

### Status

R6 and R7 now hold on finite-search evidence. R8 still gates: a finite
`block_pruning_depth` stays disabled network-wide until the whole differential
suite is green in CI and the change is carried through a reset or
activation-height gate.

## 16. R8: load-path guards and the snapshot tier

R8 requires that no replay/snapshot/checkpoint path silently re-enable block
pruning, and that the snapshot tier's missing `block_pruning_depth` handling be
resolved.

### What each load path does with the pruning policy

| Path | Entry point | Block-pruning policy |
|------|-------------|----------------------|
| Log replay | `LedgerStore::open*` | Accepts a `PruningPolicy` and applies it **before** replay; mid-replay eviction is bounded by the `remaining` parent-count sweep (`prune_replay_final`). Already correct. |
| Snapshot | `Ledger::read_snapshot_impl` | **v3 stores and restores `block_pruning_depth`** (see below). |
| Checkpoint | `Ledger::read_checkpoint_impl` | Deliberately **not** persisted: the checkpoint starts with block pruning disabled and documents that the caller re-applies its profile depth via `Node::set_block_pruning_depth`. It never *re-enables* pruning, so it is R8-safe. |

### Snapshot format v3

The snapshot header was `magic(4) + version(2) + subsidy(8) + halving_era(8) +
finality_depth(8) + payload_pruning_depth(8)` (38 bytes). `LEDGER_VERSION` is now
`3` and the header carries `block_pruning_depth(8)` (46 bytes).
`read_snapshot_impl` accepts v2 and v3 (`2..=LEDGER_VERSION`), defaulting a v2
snapshot to `block_pruning_depth = u64::MAX`, and restores the policy **after**
the replay (replaying under a finite depth would evict mid-rebuild).

### The snapshot cannot represent a block-pruned DAG

The snapshot does not store deltas; it rebuilds them by replaying each block's
payload (`insert_raw_block`). A block whose parent was evicted is encoded as a
stub, so re-admission fails with `Dag(MissingParent)`; and even if the stub were
reconstructed, an evicted block's payload is pruned, so its delta could not be
rebuilt. The ledger snapshot tier therefore **fundamentally requires an unpruned
DAG**.

Rather than emit a snapshot that cannot be reloaded, `Ledger::write_snapshot`
now returns `Result<Vec<u8>, LedgerSnapshotError>` and refuses with
`LedgerSnapshotError::BlockPruningUnsupported` when
`self.dag.pruning_point() != self.dag.genesis()` (i.e. the DAG has evicted
blocks). A node that wants both block pruning and a fast-restore artifact must
use the checkpoint or log tier.

### Tests

`crates/kovanica-state/tests/rfc009_snapshot_pruning.rs`:
`snapshot_round_trip_preserves_a_finite_block_pruning_depth` (finite depth, no
eviction, round-trips), `snapshot_write_is_refused_after_block_pruning_evicts`
(the guard), and `snapshot_round_trip_preserves_disabled_block_pruning`.

### Status

With R8 the load paths are guarded: the log path already applied the policy, the
snapshot stores/restores it and refuses an unrepresentable DAG, and the
checkpoint stays disabled-by-default and never re-enables pruning. A finite
`block_pruning_depth` remains disabled network-wide until (A+) — a consensus-rule
change — is carried through a reset or activation-height gate.
