//! The GHOSTDAG colouring algorithm.
//!
//! GHOSTDAG (Sompolinsky, Wyborski & Zohar — the protocol behind Kaspa, and a
//! refinement of PHANTOM) turns a block DAG's *partial* order into consensus
//! data from which a *total* order can be derived. For each block it computes:
//!
//! 1. a **selected parent** — the parent with the heaviest blue work;
//! 2. a **mergeset** — the blocks in the new block's past that the selected
//!    parent did not already capture (the selected parent's anticone within the
//!    new block's past);
//! 3. a **blue/red colouring** of that mergeset under the *k-cluster rule*: a
//!    block stays blue only while every blue block's blue anticone stays `<= k`.
//!
//! Blue blocks are the well-connected, honest-looking cluster; red blocks are
//! the ones an attacker (or severe latency) left too far to the side. The
//! block's blue set is its selected parent's blue set, plus the selected
//! parent, plus the newly blue mergeset blocks.
//!
//! The colouring follows the mergeset in topological order and checks the
//! k-cluster rule against the *entire* blue set being built, which is what makes
//! the result independent of block-arrival order and identical on every node.
//!
//! ## Sparse blue anticone sizes (RFC-009 R6)
//!
//! A block's `blue_anticone_sizes` map is **sparse**: it stores only the entries
//! this block itself sets or bumps — the newly-blue mergeset candidates and the
//! peers whose anticone they join — never a copy of the selected parent's whole
//! map. The blue set is enumerated on demand by walking the selected-parent
//! chain ([`Dag::try_colour_blue`]), and a blue's current size is found by
//! walking the chain to the most recent block that recorded it
//! ([`Dag::blue_anticone_size`]). This is the Kaspa design: per-block state is
//! O(k) rather than O(blue set), so retained colouring state no longer grows
//! with the pruning window. See `docs/RFC-009-SPARSE-MAP-DESIGN.md`.

use std::collections::HashMap;

use crate::block::BlockId;
use crate::dag::{Dag, GhostdagData, KParam};

impl Dag {
    /// Derive GHOSTDAG data for a new block given its parents. Reachability and
    /// the mergeset come from the oracle; does not mutate the DAG.
    pub(crate) fn compute_ghostdag(&self, parents: &[BlockId]) -> GhostdagData {
        let selected_parent = self
            .select_parent(parents)
            .expect("non-genesis block always has at least one parent");

        // Mergeset = past(block) \ (past(selected_parent) ∪ {selected_parent}):
        // exactly the blocks in the selected parent's anticone that the new block
        // merges in, in the deterministic topological order shared with the
        // linearization (see [`Dag::mergeset_ordered`]).
        let mergeset = self.mergeset_ordered(selected_parent, parents);
        let sp_node = &self.nodes[&selected_parent];

        // RFC-009 R6: the blue anticone map is *sparse*. Seed it with the
        // selected parent (always blue, and always 0 at this block's blue set —
        // its own blues are all in its past, hence not in its anticone). Nothing
        // is cloned from the selected parent.
        let mut blue_anticone_sizes: HashMap<BlockId, KParam> =
            HashMap::with_capacity(self.k() as usize + 1);
        blue_anticone_sizes.insert(selected_parent, 0);

        let mut mergeset_blues = Vec::new();
        let mut mergeset_reds = Vec::new();

        for &candidate in &mergeset {
            match self.try_colour_blue(
                &candidate,
                &selected_parent,
                &mergeset_blues,
                &blue_anticone_sizes,
            ) {
                Some(increments) => {
                    // Record the candidate's own blue anticone size, then bump
                    // every blue block that has the candidate in its anticone.
                    blue_anticone_sizes.insert(candidate, increments.len() as KParam);
                    for b in increments {
                        // Sparse: the peer may not be a key of *this* block's map,
                        // so read its current size from the chain rather than
                        // assuming a local entry.
                        let size =
                            self.blue_anticone_size(&b, &selected_parent, &blue_anticone_sizes);
                        blue_anticone_sizes.insert(b, size + 1);
                    }
                    mergeset_blues.push(candidate);
                }
                None => mergeset_reds.push(candidate),
            }
        }

        // Blue score / work fold in the selected parent's blue set (including
        // the selected parent) plus the newly blue mergeset blocks.
        let sp_gd = &sp_node.ghostdag;
        let blue_score = sp_gd.blue_score + 1 + mergeset_blues.len() as u64;
        let mut blue_work = sp_gd.blue_work + self.nodes[&selected_parent].block.work();
        for b in &mergeset_blues {
            blue_work += self.nodes[b].block.work();
        }

        // RFC-009 R3: the map is sparse, so it is far smaller than the blue set.
        // The two facts that must hold are: it never exceeds the blue set, and it
        // always contains the selected parent (every block's colouring is seeded
        // from it).
        debug_assert!(
            blue_anticone_sizes.len() as u64 <= blue_score,
            "blue anticone map must not exceed the blue set"
        );
        debug_assert!(
            blue_anticone_sizes.contains_key(&selected_parent),
            "blue anticone map must contain the selected parent"
        );

        GhostdagData {
            selected_parent: Some(selected_parent),
            mergeset_blues,
            mergeset_reds,
            blue_score,
            blue_work,
            blue_anticone_sizes,
        }
    }

    /// Pick the selected parent: the parent with the heaviest [`Dag::chain_key`].
    fn select_parent(&self, parents: &[BlockId]) -> Option<BlockId> {
        parents.iter().copied().max_by_key(|p| self.chain_key(p))
    }

    /// The current blue anticone size of `block` as seen from a new block whose
    /// selected parent is `selected_parent` and whose in-progress sparse map is
    /// `current`.
    ///
    /// Walks from `current` (the new block's own entries) down the
    /// selected-parent chain; the first hit is the most recent value (a size is
    /// only ever recorded where it is set or bumped, so last-writer-wins is
    /// exact). A block that was never recorded is 0.
    fn blue_anticone_size(
        &self,
        block: &BlockId,
        selected_parent: &BlockId,
        current: &HashMap<BlockId, KParam>,
    ) -> KParam {
        if let Some(&size) = current.get(block) {
            return size;
        }
        let mut cur = Some(*selected_parent);
        while let Some(id) = cur {
            let node = match self.nodes.get(&id) {
                Some(node) => node,
                None => break,
            };
            if let Some(&size) = node.ghostdag.blue_anticone_sizes.get(block) {
                return size;
            }
            cur = node.ghostdag.selected_parent;
        }
        0
    }

    /// Try to colour `candidate` blue against the blue set reachable from
    /// `selected_parent`.
    ///
    /// The blue set is enumerated on demand: `new_blues` are the mergeset blocks
    /// already coloured blue in this block's colouring loop, and the rest is the
    /// selected-parent chain — each chain block is blue, and so are its
    /// `mergeset_blues`. The walk stops as soon as a chain block is an ancestor
    /// of the candidate, because every deeper blue is then an ancestor too and
    /// so cannot be in the candidate's anticone.
    ///
    /// Returns `Some(blues_in_candidate_anticone)` if the candidate can be blue
    /// without any blue block (candidate included) exceeding a blue anticone of
    /// `k`; the returned blocks are those whose recorded size must be bumped.
    /// Returns `None` if the candidate must be red.
    fn try_colour_blue(
        &self,
        candidate: &BlockId,
        selected_parent: &BlockId,
        new_blues: &[BlockId],
        current: &HashMap<BlockId, KParam>,
    ) -> Option<Vec<BlockId>> {
        let k = self.k();
        let mut anticone_blues = Vec::new();

        let count = |blue: BlockId,
                     anticone_blues: &mut Vec<BlockId>,
                     current: &HashMap<BlockId, KParam>|
         -> Option<()> {
            // RFC-009: an *evicted* id can still be referenced by a surviving
            // block's stored `mergeset_blues` (the reference is frozen at the
            // referencing block's construction, before the block was evicted).
            // The reachability oracle can no longer answer for it, so
            // `in_anticone` would degrade to a phantom `true` — the F1 failure
            // mode the (B1) trim used to filter out (here: never enumerated).
            // Skipping is exact: eviction removes `past(P) \ {genesis}`, and
            // every (A+)-admissible candidate lies in `future(P) ∪ {P}`, so
            // each evicted block is an ancestor of the candidate — not in its
            // anticone. A candidate for which this would matter is rejected by
            // (A+) anyway, so its colouring is discarded.
            if !self.nodes.contains_key(&blue) {
                return Some(());
            }
            if !self.in_anticone(&blue, candidate) {
                return Some(());
            }
            let size = self.blue_anticone_size(&blue, selected_parent, current);
            // The candidate would see one more blue in its anticone …
            if anticone_blues.len() as KParam + 1 > k {
                return None;
            }
            // … and `blue` would see the candidate added to its anticone.
            if size + 1 > k {
                return None;
            }
            anticone_blues.push(blue);
            Some(())
        };

        // Mergeset blocks already coloured blue in this block.
        for &blue in new_blues {
            count(blue, &mut anticone_blues, current)?;
        }

        // The selected-parent chain: chain blocks and their mergeset blues.
        let mut cur = Some(*selected_parent);
        while let Some(id) = cur {
            let node = match self.nodes.get(&id) {
                Some(node) => node,
                None => break,
            };
            if self.is_ancestor(&id, candidate) {
                // `id` and everything below it are in the candidate's past.
                break;
            }
            count(id, &mut anticone_blues, current)?;
            for &blue in &node.ghostdag.mergeset_blues {
                count(blue, &mut anticone_blues, current)?;
            }
            cur = node.ghostdag.selected_parent;
        }

        Some(anticone_blues)
    }
}
