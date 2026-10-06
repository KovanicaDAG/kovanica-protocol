# RFC-009 — Sparse `blue_anticone_sizes` map (design)

**Status:** Draft / design · **Layer:** consensus-critical (changes `GhostdagData` and the colouring algorithm; must be semantics-preserving) · **Owner:** kovanica-core · **Depends on:** RFC-009 R1–R8 (all hold).

**Goal.** Make per-block GHOSTDAG colouring state **independent of the blue-set size**, so a mainnet `block_pruning_depth` of 10,000 (and beyond) is viable. This is the follow-up named in `RFC-009-ACTIVATION-PLAN.md` §1 and `RFC-009-DESIGN-ANALYSIS.md` §15.

## 1. Problem

`GhostdagData.blue_anticone_sizes: HashMap<BlockId, KParam>` currently stores, for **every** blue block in the retained window, the size of that blue's anticone within the blue set.

- `compute_ghostdag` **clones the selected parent's whole map** (`ghostdag.rs:47`) and then inserts the new blues.
- `try_colour_blue` **iterates the whole map** (`ghostdag.rs:174`) to count how many blues are in the candidate's anticone.

Consequences (measured, R6 / `rfc009_memory_bound.rs`):

- per-block map ≈ **O(D)** (the retained blue set), total retained ≈ **O(D²)** for a chain;
- chain-length independence holds (the (B1) trim bounds it to the pruning window), so it is *not* O(chain²) — but D=10,000 ⇒ ~1e8 entries ≈ 4 GB.

R6's literal target (`~O(D × width)`) needs the map to stop being a full copy.

## 2. Kaspa prior art (decisive)

`kaspanet/rusty-kaspa` `consensus/src/processes/ghostdag/protocol.rs` + `model/stores/ghostdag.rs`:

- `blues_anticone_sizes` is **sparse**: it holds only the entries **affected by this block's own newly-added blue blocks**, not the full blue set. `GhostdagData::new_with_selected_parent(sp, k)` allocates capacity `k`, it does **not** clone the parent's map.
- The blue set is **enumerated by walking the selected-parent chain**: for each `ChainBlock` (starting at the new block), iterate `chain_block.data.mergeset_blues`. Each blue was added as a `mergeset_blues` entry of exactly one chain block, so the union over the chain is the whole blue set.
- `check_blue_candidate(candidate)`:
  - for each peer in a chain block's `mergeset_blues`: a peer is in the candidate's anticone unless `is_dag_ancestor_of(peer, candidate)`;
  - **early termination**: if the chain block itself is an ancestor of the candidate, every remaining blue is in the candidate's past ⇒ stop (Blue).
- `blue_anticone_size(block)`: walk the selected-parent chain from the current context, checking each ancestor's sparse map, until an entry for `block` is found (last writer wins).
- `add_blue(candidate, size, &map)`: store **only** the candidate and the peers whose size it incremented.

Per-block state therefore becomes **O(k × mergeset)**, independent of the blue-set size.

## 3. Kovanica adaptation

Keep the public API (`GhostdagData`, `compute_ghostdag`, `mergeset_blues/reds`, `blue_score`, `blue_work`) unchanged; change only the *meaning* of `blue_anticone_sizes` from "full map" to "sparse delta for this block".

1. **Stop cloning.** `blue_anticone_sizes` starts **empty** for the new block (capacity hint `k`), instead of `sp.blue_anticone_sizes.clone()`.
2. **`blue_anticone_size(ctx, b)` helper** — walk the selected-parent chain from `ctx` (the new block's selected parent, then its ancestors) and return the first stored size for `b`; absent ⇒ `0`. Uses `nodes[id].ghostdag.selected_parent`.
3. **`try_colour_blue` rewrite** — instead of iterating the map:
   - walk the chain from the new block's selected parent;
   - at each chain block, iterate its `mergeset_blues`;
   - `if self.is_ancestor(peer, candidate) { continue; }` (peer is in the candidate's past ⇒ not anticone);
   - `let size = self.blue_anticone_size(ctx, peer);` if `size + 1 > k` ⇒ Red;
   - count anticone blues; if `> k` ⇒ Red;
   - **early termination**: `if self.is_ancestor(chain_block, candidate) { break; }`.
   - Return the list of anticone peers (the "increments") so `add_blue` can store `candidate ⇒ |increments|` and `peer ⇒ size + 1`.
4. **`add_blue`** — the new block's sparse map gets `{candidate: increments.len()} ∪ {(peer, size(peer)+1) for peer in increments}`. Entries for unchanged blues are simply absent (found via the chain walk).
5. **The (B1) trim is no longer needed** — the map never holds `past(P)` entries in the first place. Remove it (or keep as a debug assertion).
6. **R3 invariant** — `blue_anticone_sizes.len() <= blue_score` still holds trivially (sparse ≪ full). Add a debug assertion that the map is a subset of the blue set.

## 4. Interaction with (A+) and pruning

- With the (A+) admission rule enforced, every candidate is in `future(P) ∪ {P}`, so the chain walk and every `blue_anticone_size` lookup stay within **retained** blocks. No evicted block is ever read.
- Without (A+) (i.e. `insert_for_replay`, or pruning disabled and an anticone candidate), the chain walk may descend below `P`; the sparse lookup must then tolerate a missing entry (`0`) rather than panic. This is the same case (B1) was built for; the sparse form makes it cheaper but no less exact.
- `Dag::remove_blocks` no longer has to strip evicted ids from retained maps (there are none to strip) — R5 becomes structurally simpler.

## 5. Correctness argument (must be identical to today)

The current code colours `candidate` red iff the number of blue blocks in `candidate`'s anticone would exceed `k`, or any blue's anticone would exceed `k`. The sparse rewrite computes exactly the same two quantities:

- the anticone peer set is enumerated identically (the chain walk yields the same blue set the full map held, restricted to the retained window — which is all the full map ever held after the (B1) trim);
- each `blue_anticone_size(peer)` returns the same value the full map stored (last-writer-wins along the chain mirrors the in-place `+= 1` increments).

So the colouring decision is unchanged; only the *storage* changes. R2 (exact k=3 semantics) is preserved.

## 6. Verification plan (the gate)

1. **R4 differential** (`block_pruning_colouring.rs`, 6 tests) must stay green **unchanged**.
2. **R6 memory** (`rfc009_memory_bound.rs`): assert the per-block map is now O(k) — i.e. `max_map` no longer grows with `D` — and total state is ~O(D × width). Tighten the existing assertions from "≈ depth" to a small constant bound.
3. **R5 eviction** (`block_pruning_eviction.rs`) and **R7** (`rfc009_rejection_equivalence.rs`) unchanged.
4. **Adaptive differential probe** (the one that found the (A) 344/8000 gap): re-run; must remain 0 divergences.
5. **Full suite** + `clippy`; then a bounded replay memory check (`estimate_replay_peak_bytes` / `replay-watchdog`).

## 7. Risks

- **Consensus-critical**: a subtle enumeration difference (missed blue, wrong early termination) changes colouring ⇒ fork. Mitigation: the differential gate above is exhaustive over retained blocks and is the same gate that caught the earlier (A)/(A+) defects.
- **Time complexity**: `blue_anticone_size` is a chain walk per lookup; worst case O(D) per peer ⇒ O(D × k × mergeset) per insert. Acceptable at D=1000 (testnet) and the point of the exercise at D=10,000; a per-insert cache can follow if profiling demands it.
- **Determinism**: the chain walk is ordered (selected-parent links); map iteration must stay order-independent (tie-breaks by `BlockId`).

## 8. Non-goals

No change to `k=3`, the mergeset definition, `blue_score`/`blue_work`, the wire/checkpoint/snapshot formats, or the (A+) rule. Pure storage refactor.
