//! The append-only block DAG store and its GHOSTDAG metadata.
//!
//! The [`Dag`] owns every block plus the consensus data GHOSTDAG derives for it
//! (see [`crate::ghostdag`]) and the total order it induces (see
//! [`crate::ordering`]). Blocks are inserted one at a time; each insert is
//! validated and immediately coloured, so the store always holds a fully
//! processed DAG.
//!
//! ## Reachability
//!
//! Ancestor queries and mergeset computation go through a [`Reachability`]
//! oracle (interval-labelled selected-parent tree + future-covering sets), so no
//! per-block `past` set is stored — each block keeps only its `past_size` (the
//! *count* of its ancestors), which is enough for the topological sort key. The
//! oracle is maintained **incrementally**: each insert folds in just the one new
//! block (Kaspa reachability / interval reindexing) rather than rebuilding from
//! scratch (see [`crate::reachability`]).
//!
//! ## Payload pruning
//!
//! The DAG supports **payload pruning** to bound memory and disk usage. Each
//! [`Block`] carries an `Option<Vec<u8>>` payload — `Some(payload)` when the
//! block is recent, `None` once it is sufficiently finalized. A block is
//! considered **prunable** when its blue score is more than
//! `payload_pruning_depth` below the selected tip's blue score.
//!
//! ### Why the reachability oracle makes pruning safe
//!
//! The [`Reachability`] oracle answers `is_ancestor` and computes mergesets from
//! the **selected-parent tree** (interval labels) and **future-covering sets**,
//! which depend *only* on the DAG's topology (each block's parents and its
//! GHOSTDAG selected parent). It never inspects block payloads. Therefore,
//! evicting a block's payload does not affect any reachability query:
//! `is_ancestor`, `in_anticone`, `mergeset_ordered`, and the GHOSTDAG colouring
//! all continue to work correctly on pruned blocks.
//!
//! ### Pruning strategy
//!
//! - `payload_pruning_depth` is a parameter on [`Dag`] (default: `u64::MAX`,
//!   meaning pruning disabled).
//! - After each insert, [`Dag::prune_old_payloads`] is called. It computes the
//!   pruning threshold as `selected_tip.blue_score.saturating_sub(payload_pruning_depth)`.
//! - Any block with `blue_score < threshold` has its payload set to `None` via
//!   [`Block::prune_payload`].
//! - Genesis is never pruned (its blue score is 0, but it's the root).
//! - Pruning is idempotent: once `payload = None`, it stays `None`.
//!
//! ### Interaction with `Ledger::with_finality`
//!
//! The ledger layer has its own `finality_depth` ([`Ledger::with_finality`])
//! which prunes *per-block UTXO state* and rejects blocks built on final
//! history. The DAG's `payload_pruning_depth` is a separate (typically larger)
//! threshold that only evicts the opaque payload bytes. The two depths are
//! independent:
//! - `finality_depth` bounds the *state* the ledger must keep to validate new
//!   blocks.
//! - `payload_pruning_depth` bounds the *payloads* the DAG keeps for sync/serving.
//!
//! A typical configuration sets `payload_pruning_depth > finality_depth` so that
//! a node can still serve block bodies for blocks that are final (and thus
//! immutable) but no longer needed for validation.
//!
//! ### Snapshots
//!
//! When writing a snapshot ([`Dag::write_snapshot`]), pruned blocks are encoded
//! with an empty payload. On load ([`Dag::read_snapshot`]), they are
//! reconstructed with `payload = None` via [`Block::new_pruned`]. The block's
//! id (computed at insertion time over the original payload) is preserved in the
//! DAG's `nodes` map, so consensus integrity is maintained.
//!
//! ## Block pruning (full block eviction)
//!
//! Beyond payload pruning, the DAG supports **block pruning**: evicting entire
//! blocks (their payloads *and* their consensus metadata) once they are deep
//! enough below the selected tip. This bounds the DAG's memory footprint the
//! way payload pruning bounds its payload bytes — but it is a consensus-level
//! operation, because evicted blocks are no longer available to serve or to
//! build on.
//!
//! ### Pruning strategy
//!
//! - `block_pruning_depth` is a parameter on [`Dag`] (default: `u64::MAX`,
//!   meaning pruning disabled).
//! - After each insert, [`Dag::prune_old_blocks`] is called. It computes the
//!   pruning threshold as `selected_tip.blue_score.saturating_sub(block_pruning_depth)`
//!   and the **pruning point** `P` as the lowest block on the selected-parent
//!   chain with `blue_score >= threshold` ([`Dag::pruning_point`]).
//! - Every block in `past(P)` except genesis is evicted: removed from the DAG's
//!   `nodes`, from the tips, and from the [`Reachability`] oracle. Genesis is
//!   never evicted.
//!
//! ### Why it is safe
//!
//! The evicted set `past(P)` is **downward-closed** in the reachability tree
//! (the selected-parent tree): if a block is evicted, so are all its
//! tree-ancestors. Therefore the present blocks that referenced an evicted
//! block as their selected parent can be re-parented to genesis without any
//! interval re-layout — their intervals already lie inside genesis's allocated
//! region. Present blocks never have evicted children (a child's parent is in
//! its past), so the tips are simply the old tips minus the evicted ones.
//!
//! ### Insert-time invariant
//!
//! When block pruning is enabled, **every parent and every mergeset candidate**
//! of a new block must be in `future(P) ∪ {P}` (i.e. `== P` or `P` is an
//! ancestor); otherwise the insert is rejected with
//! [`DagError::BuildsOnPrunedHistory`]. Requiring all parents (not only the
//! selected parent) is RFC-009 design **(A+)**. The parent check alone is *not*
//! sufficient: an `anticone(P)` block can be an ancestor of a `future(P)` parent
//! and still surface as a mergeset candidate, and for such a candidate the
//! `past(P)` blues that eviction removes are *not* inert — (B1) under-counts and
//! colours it blue where an unpruned node colours it red (the §13 counterexample
//! and the 344/8000 divergences of §14). Checking the candidates themselves is
//! the tight condition: (B1) is exact **iff** every candidate lies in
//! `future(P) ∪ {P}`. See `docs/RFC-009-DESIGN-ANALYSIS.md` §13-§14.
//!
//! ### Snapshots
//!
//! A snapshot of a block-pruned DAG contains only the present blocks. A present
//! block may reference an evicted parent; on load ([`Dag::read_snapshot`]) such
//! parents are reconstructed as pruned **stubs** (children of genesis) so the
//! replay can proceed, and the stubs are evicted again once the replay
//! completes. The snapshot format is unchanged.
//!
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};

use crate::authority::{AuthorityError, AuthoritySet, AuthorityUpdateTx};
use crate::block::{Block, BlockId};
use crate::reachability::Reachability;
use crate::validation::BlockValidator;

/// Errors returned when inserting a block into the [`Dag`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DagError {
    /// A block with this id is already present.
    DuplicateBlock(BlockId),
    /// A referenced parent is not in the DAG.
    MissingParent(BlockId),
    /// A non-genesis block referenced no parents.
    NoParents(BlockId),
    /// `insert_genesis` was called on a DAG that already has a genesis.
    GenesisAlreadySet,
    /// The installed [`BlockValidator`] rejected the block, with its reason.
    InvalidBlock { id: BlockId, reason: String },
    /// Difficulty is enforced and the block's timestamp precedes a parent's —
    /// a block may not be older than a block it builds on.
    NonMonotonicTimestamp {
        id: BlockId,
        timestamp_ms: u64,
        parent_timestamp_ms: u64,
    },
    /// PoA is enforced (see [`Dag::set_poa`]) and the block's authority
    /// signature is missing, does not verify against the authority scheduled
    /// for its slot, or its slot precedes a parent's (RFC-POA §4.2–4.3).
    InvalidAuthoritySignature { id: BlockId, reason: String },
    /// PoA is enforced (see [`Dag::set_poa`]) and the block's `work` is not the
    /// nominal [`POA_NOMINAL_WORK`] — an authority tried to buy chain weight
    /// with an unproven value (RFC-POA §4 item 5).
    PoaWorkMismatch {
        id: BlockId,
        expected: u128,
        actual: u128,
    },
    /// Block pruning is enabled (see [`Dag::set_block_pruning_depth`]) and the
    /// block's selected parent is not in `future(P) ∪ {P}` where `P` is the
    /// pruning point ([`Dag::pruning_point`]) — the block would build on
    /// already-evicted history.
    BuildsOnPrunedHistory { id: BlockId },
}

impl core::fmt::Display for DagError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            DagError::DuplicateBlock(id) => write!(f, "duplicate block {id}"),
            DagError::MissingParent(id) => write!(f, "missing parent {id}"),
            DagError::NoParents(id) => write!(f, "non-genesis block {id} has no parents"),
            DagError::GenesisAlreadySet => write!(f, "genesis already set"),
            DagError::InvalidBlock { id, reason } => {
                write!(f, "block {id} rejected by validator: {reason}")
            }
            DagError::NonMonotonicTimestamp {
                id,
                timestamp_ms,
                parent_timestamp_ms,
            } => write!(
                f,
                "block {id} timestamp {timestamp_ms}ms precedes parent timestamp {parent_timestamp_ms}ms"
            ),
            DagError::InvalidAuthoritySignature { id, reason } => write!(
                f,
                "block {id} has invalid authority signature: {reason}"
            ),
            DagError::PoaWorkMismatch {
                id,
                expected,
                actual,
            } => write!(f, "PoA block {id} work {actual} ≠ nominal {expected}"),
            DagError::BuildsOnPrunedHistory { id } => write!(
                f,
                "block {id} builds on pruned history (its selected parent is not in the pruning point's future)"
            ),
        }
    }
}

impl std::error::Error for DagError {}

/// The `k` parameter of GHOSTDAG: the maximum tolerated blue anticone size.
///
/// It bounds how many well-connected blocks may be mutually "parallel" (in each
/// other's anticone) while still all counting as blue. Larger `k` tolerates
/// higher block rates / latency at the cost of a wider security margin.
pub type KParam = u16;

/// Consensus metadata GHOSTDAG derives for a single block.
///
/// A block's *blue set* is the set of blue blocks in its past. It is built from
/// its selected parent's blue set plus the blues found in its mergeset.
#[derive(Clone, Debug)]
pub struct GhostdagData {
    /// The parent with the heaviest blue work (see [`Dag::chain_key`]).
    /// `None` only for genesis.
    pub selected_parent: Option<BlockId>,
    /// Mergeset blocks coloured blue, in the topological order they were added.
    pub mergeset_blues: Vec<BlockId>,
    /// Mergeset blocks coloured red, in topological order.
    pub mergeset_reds: Vec<BlockId>,
    /// Size of this block's blue set (number of blue blocks in its past).
    pub blue_score: u64,
    /// Total work of this block's blue set.
    pub blue_work: u128,
    /// For each blue block in this block's blue set, the number of blue blocks
    /// in *its* anticone (restricted to this blue set). The invariant GHOSTDAG
    /// maintains is that every value here is `<= k`.
    pub blue_anticone_sizes: HashMap<BlockId, KParam>,
}

/// The GHOSTDAG data a block *would* receive, computed by [`Dag::preview`]
/// without inserting the block.
#[derive(Clone, Debug)]
pub struct BlockPreview {
    /// The parent that would be the block's selected parent.
    pub selected_parent: BlockId,
    /// The block's mergeset, in the deterministic order the linearization uses.
    pub mergeset: Vec<BlockId>,
}

/// A stored block: the block itself plus derived DAG/consensus data.
pub(crate) struct Node {
    pub(crate) block: Block,
    /// Number of strict ancestors of this block (`|past|`). The full set is not
    /// stored — reachability comes from the oracle — but the count is the
    /// topological sort key and is maintained in O(1): `past_size(sp) + 1 +
    /// |mergeset|`.
    pub(crate) past_size: u64,
    /// Direct children, for tip maintenance and total-order traversal.
    pub(crate) children: BTreeSet<BlockId>,
    pub(crate) ghostdag: GhostdagData,
}

/// An append-only block DAG with GHOSTDAG consensus data.
pub struct Dag {
    k: KParam,
    genesis: BlockId,
    pub(crate) nodes: HashMap<BlockId, Node>,
    /// Blocks with no children yet — the current tips.
    tips: BTreeSet<BlockId>,
    /// Reachability oracle backing `is_ancestor` and mergeset computation,
    /// maintained incrementally on each insert (see [`crate::reachability`]).
    reach: Reachability,
    /// Optional payload-aware validator run on each [`Dag::insert`]. See
    /// [`crate::validation`].
    validator: Option<Box<dyn BlockValidator>>,
    /// Payload pruning depth: blocks more than this many blue score units below
    /// the selected tip have their payloads evicted (`payload = None`).
    /// `u64::MAX` means pruning is disabled (the default).
    payload_pruning_depth: u64,
    /// Block pruning depth: blocks more than this many blue score units below
    /// the selected tip are evicted entirely (removed from the DAG and the
    /// reachability oracle). `u64::MAX` means pruning is disabled (the default).
    /// See [`Dag::prune_old_blocks`] and [`Dag::pruning_point`].
    block_pruning_depth: u64,
    /// Consensus-enforced Proof-of-Authority policy (RFC-POA §4). When
    /// `Some`, each [`Dag::insert`] of a non-genesis block requires a valid
    /// authority signature from the authority scheduled for its slot, and a
    /// slot not preceding any parent's. Replaces PoW/difficulty/VRF admission
    /// (enabling it clears those switches). Off by default (`None`).
    poa: Option<PoAConfig>,
}

/// The `work` every block must claim while PoA is enforced
/// (RFC-POA §4 item 5).
///
/// Under PoW, `work` is a proof: the harder it is to find, the more the block
/// should be favoured by chain selection. Under PoA it proves nothing — an
/// authority's signature is the only admission credential — but it is *still*
/// folded into `blue_work` by the GHOSTDAG fold (see [`crate::ghostdag`]),
/// and `blue_work` drives the selected-parent choice. Left unpinned, `work`
/// becomes an unauthenticated consensus input: any one authority could stamp
/// an arbitrarily large value on its block and unilaterally steer the
/// selected parent of every successor, defeating the round-robin fairness
/// that is the whole point of PoA.
///
/// Pinning it at admission is therefore not cosmetic — it is what makes
/// `blue_work` provably nominal, and it is why no change is needed in the
/// GHOSTDAG fold: every block that reaches insertion has
/// `work == POA_NOMINAL_WORK`, so the accumulated blue work is a plain block
/// count. This mirrors the `nominal_work` pin that the staked-VRF path used to
/// carry — that path, and the `HybridConfig` it lived in, were removed with
/// PoW, so there is nothing left to link to.
///
/// This is a constant rather than a [`PoAConfig`] field because, unlike a
/// staked block competing against real PoW blocks, there is nothing to tune:
/// PoA blocks are one-per-slot and all carry equal weight by construction.
/// (Consensus parameter — all nodes must agree on it, like `k`.)
pub const POA_NOMINAL_WORK: u128 = 1;

/// PoA consensus enforcement configuration (RFC-POA §3–4).
#[derive(Clone, Debug)]
pub struct PoAConfig {
    /// The live authority set: the scheduled producer for a slot is
    /// `authorities[slot % len]` (see [`AuthoritySet::active_authority`]).
    pub authority_set: AuthoritySet,
    /// Slot duration in milliseconds: `slot = timestamp_ms / slot_duration_ms`.
    pub slot_duration_ms: u64,
}

impl Dag {
    /// Create a DAG seeded with `genesis` and the GHOSTDAG parameter `k`.
    pub fn new(k: KParam, genesis: Block) -> Self {
        let genesis_id = genesis.id();
        let mut nodes = HashMap::new();
        nodes.insert(
            genesis_id,
            Node {
                block: genesis,
                past_size: 0,
                children: BTreeSet::new(),
                ghostdag: GhostdagData {
                    selected_parent: None,
                    mergeset_blues: Vec::new(),
                    mergeset_reds: Vec::new(),
                    blue_score: 0,
                    blue_work: 0,
                    blue_anticone_sizes: HashMap::new(),
                },
            },
        );
        let mut tips = BTreeSet::new();
        tips.insert(genesis_id);
        let mut dag = Self {
            k,
            genesis: genesis_id,
            nodes,
            tips,
            reach: Reachability::empty(),
            validator: None,
            payload_pruning_depth: u64::MAX,
            block_pruning_depth: u64::MAX,
            poa: None,
        };
        dag.reach = Reachability::build(&dag);
        dag
    }

    /// Create a DAG as [`Dag::new`] but with a [`BlockValidator`] installed, so
    /// every subsequent [`Dag::insert`] must pass `validator`. The genesis block
    /// itself is not validated.
    pub fn with_validator(k: KParam, genesis: Block, validator: Box<dyn BlockValidator>) -> Self {
        let mut dag = Self::new(k, genesis);
        dag.validator = Some(validator);
        dag
    }

    /// Install (or replace) the block validator run on every [`Dag::insert`].
    pub fn set_validator(&mut self, validator: Box<dyn BlockValidator>) {
        self.validator = Some(validator);
    }

    /// Enable consensus-enforced Proof-of-Authority admission (RFC-POA §4).
    ///
    /// Once enabled, every subsequent [`Dag::insert`] of a non-genesis block
    /// must satisfy:
    /// - **Authority signature.** The block must carry a 64-byte `authority_sig`
    ///   that verifies (Ed25519) over `block.hash_without_authority_sig()`
    ///   against the authority scheduled for its slot —
    ///   `authorities[slot % len]` where `slot = timestamp_ms / slot_duration_ms`
    ///   (see [`AuthoritySet::active_authority`]).
    /// - **Slot consistency.** The block's slot must be ≥ every parent's slot,
    ///   so slots are monotone along every path (like difficulty timestamps).
    ///
    /// PoA is the only admission model. It pins the block `work` to
    /// [`POA_NOMINAL_WORK`] — see that constant for why
    /// an unpinned `work` is a chain-selection vector. Genesis is exempt.
    /// Replay ([`Dag::insert_for_replay`]) skips the check — replayed blocks are
    /// trusted history whose signatures may come from an earlier authority set.
    pub fn set_poa(&mut self, authority_set: AuthoritySet, slot_duration_ms: u64) {
        self.poa = Some(PoAConfig {
            authority_set,
            slot_duration_ms,
        });
    }

    /// Disable consensus-enforced PoA (blocks no longer need authority
    /// signatures). Does not re-enable PoW/difficulty/VRF — those are
    /// independent opt-in switches.
    pub fn disable_poa(&mut self) {
        self.poa = None;
    }

    /// The current PoA enforcement config, if any.
    pub fn poa_config(&self) -> Option<&PoAConfig> {
        self.poa.as_ref()
    }

    /// Apply an on-chain authority set update (RFC-POA §1, KVP-201).
    ///
    /// Validates the `AuthorityUpdateTx` against the current authority set:
    /// - old_set_hash matches current authority set hash
    /// - ≥ threshold distinct signatures from current authorities
    /// - signatures verify over the canonical update payload
    ///
    /// On success, replaces the current authority set with the new set.
    /// Returns the new AuthoritySet for the caller to persist.
    pub fn apply_authority_update(
        &mut self,
        update: &AuthorityUpdateTx,
    ) -> Result<AuthoritySet, AuthorityError> {
        let current = self.poa_config().ok_or(AuthorityError::PoANotEnabled)?;
        update.validate(&current.authority_set)?;
        let new_set = update.new_set().clone();
        self.poa = Some(PoAConfig {
            authority_set: new_set.clone(),
            slot_duration_ms: current.slot_duration_ms,
        });
        Ok(new_set)
    }

    /// Set the payload pruning depth: blocks more than `depth` blue score units
    /// below the selected tip will have their payloads evicted on the next insert
    /// (or when [`Dag::prune_old_payloads`] is called explicitly). `u64::MAX`
    /// (the default) disables payload pruning.
    ///
    /// The pruning threshold is computed as `selected_tip.blue_score.saturating_sub(depth)`.
    /// Any block with `blue_score < threshold` has its payload set to `None`.
    /// Genesis is never pruned.
    pub fn set_payload_pruning_depth(&mut self, depth: u64) {
        self.payload_pruning_depth = depth;
    }

    /// The current payload pruning depth. `u64::MAX` means pruning is disabled.
    pub fn payload_pruning_depth(&self) -> u64 {
        self.payload_pruning_depth
    }

    /// The blue-score threshold below which blocks are prunable: blocks with a
    /// blue score `< payload_pruning_score()` have their payloads evicted.
    /// Returns `0` when pruning is disabled or the DAG is not yet deep enough.
    pub fn payload_pruning_score(&self) -> u64 {
        if self.payload_pruning_depth == u64::MAX {
            return 0;
        }
        let tip = self.selected_tip();
        let max = self.ghostdag(&tip).map_or(0, |g| g.blue_score);
        max.saturating_sub(self.payload_pruning_depth)
    }

    /// Evict payloads of all blocks whose blue score is below the pruning
    /// threshold ([`Dag::payload_pruning_score`]). Idempotent: blocks already
    /// pruned stay pruned. Genesis is never pruned.
    ///
    /// This is called automatically at the end of [`Dag::insert`] when
    /// `payload_pruning_depth` is finite, but can also be invoked manually
    /// (e.g. after loading a snapshot or changing the pruning depth).
    pub fn prune_old_payloads(&mut self) {
        let threshold = self.payload_pruning_score();
        if threshold == 0 {
            return;
        }
        // Compute the payload pruning point: the lowest selected-chain block
        // with blue_score >= threshold. Only prune payloads of blocks in
        // past(P) (the pruned region), not anticone blocks which are needed
        // for ledger_state().
        let p = self.payload_pruning_point();
        // Collect candidate block ids first to avoid borrow conflicts.
        let candidates: Vec<BlockId> = self
            .nodes
            .values()
            .filter(|node| {
                node.ghostdag.blue_score != 0
                    && node.ghostdag.blue_score < threshold
                    && !node.block.is_pruned()
            })
            .map(|node| node.block.id())
            .collect();
        // No per-candidate logging here. This runs on every insert, including
        // log replay at boot. Formatting the full candidate set pinned a CPU
        // and grew the process until the cgroup OOM-killer fired, so the
        // HTTP accept loop and the P2P bind never ran.
        for nid in candidates {
            let is_anc = self.is_ancestor(&nid, &p);
            if nid == p || is_anc {
                if let Some(node) = self.nodes.get_mut(&nid) {
                    node.block.prune_payload();
                }
            }
        }
    }

    /// The **payload pruning point**: the lowest block on the selected-parent
    /// chain with `blue_score >= payload_pruning_score()`. Genesis when
    /// payload pruning is disabled or the DAG is not yet deep enough.
    pub fn payload_pruning_point(&self) -> BlockId {
        let threshold = self.payload_pruning_score();
        if threshold == 0 {
            return self.genesis;
        }
        let mut point = self.genesis;
        let mut cur = Some(self.selected_tip());
        while let Some(id) = cur {
            match self.nodes.get(&id) {
                Some(node) => {
                    if node.ghostdag.blue_score >= threshold {
                        point = id;
                    }
                    cur = node.ghostdag.selected_parent;
                }
                None => break,
            }
        }
        point
    }

    /// Set the block pruning depth: blocks more than `depth` blue score units
    /// below the selected tip will be evicted entirely on the next insert (or
    /// when [`Dag::prune_old_blocks`] is called explicitly). `u64::MAX` (the
    /// default) disables block pruning.
    ///
    /// The pruning threshold is computed as `selected_tip.blue_score.saturating_sub(depth)`
    /// and the **pruning point** `P` is the lowest selected-chain block with
    /// `blue_score >= threshold` ([`Dag::pruning_point`]). Every block in
    /// `past(P)` except genesis is evicted. Genesis is never evicted.
    ///
    /// Enabling block pruning also enforces an insert-time invariant: a new
    /// block's selected parent must be in `future(P) ∪ {P}`, otherwise the
    /// insert is rejected with [`DagError::BuildsOnPrunedHistory`].
    pub fn set_block_pruning_depth(&mut self, depth: u64) {
        self.block_pruning_depth = depth;
    }

    /// The current block pruning depth. `u64::MAX` means pruning is disabled.
    pub fn block_pruning_depth(&self) -> u64 {
        self.block_pruning_depth
    }

    /// The blue-score threshold below which blocks are evictable: the pruning
    /// point is the lowest selected-chain block with `blue_score >=
    /// block_pruning_score()`. Returns `0` when pruning is disabled or the DAG
    /// is not yet deep enough.
    pub fn block_pruning_score(&self) -> u64 {
        if self.block_pruning_depth == u64::MAX {
            return 0;
        }
        let tip = self.selected_tip();
        let max = self.ghostdag(&tip).map_or(0, |g| g.blue_score);
        max.saturating_sub(self.block_pruning_depth)
    }

    /// The **pruning point**: the lowest block on the selected-parent chain with
    /// `blue_score >= block_pruning_score()`. Genesis when pruning is disabled
    /// or the DAG is not yet deep enough.
    ///
    /// When block pruning is enabled, every block in `past(P)` except genesis is
    /// (or will be) evicted, and a new block's selected parent must be in
    /// `future(P) ∪ {P}`.
    pub fn pruning_point(&self) -> BlockId {
        self.lowest_block_at_or_above(self.block_pruning_score())
    }

    /// The lowest block on the selected-parent chain with `blue_score >=
    /// threshold`. Genesis when `threshold == 0` or the chain is not yet deep
    /// enough.
    ///
    /// Blue score strictly decreases going up the selected chain, so the last
    /// qualifying block seen walking down from the tip is the lowest one. The
    /// walk stops at an evicted block (everything below it is evicted too).
    ///
    /// This is the shared primitive behind [`Dag::pruning_point`] (block
    /// pruning) and the ledger's finality point (RFC-009 R7), so a pruning node
    /// and a non-pruning node derive the same point from the same rule.
    pub fn lowest_block_at_or_above(&self, threshold: u64) -> BlockId {
        if threshold == 0 {
            return self.genesis;
        }
        let mut point = self.genesis;
        let mut cur = Some(self.selected_tip());
        while let Some(id) = cur {
            match self.nodes.get(&id) {
                Some(node) => {
                    if node.ghostdag.blue_score >= threshold {
                        point = id;
                    }
                    cur = node.ghostdag.selected_parent;
                }
                None => break, // evicted: the point is the last present block above
            }
        }
        point
    }

    /// Evict all blocks in `past(P) \ {genesis}` where `P` is the pruning point
    /// ([`Dag::pruning_point`]): remove them from the DAG's `nodes`, from the
    /// tips, and from the [`Reachability`] oracle (re-parenting present
    /// tree-children to genesis). Idempotent: already-evicted blocks stay
    /// evicted.
    ///
    /// This is called automatically at the end of [`Dag::insert`] when
    /// `block_pruning_depth` is finite, but can also be invoked manually (e.g.
    /// after loading a snapshot or changing the pruning depth).
    pub fn prune_old_blocks(&mut self) {
        let threshold = self.block_pruning_score();
        if threshold == 0 {
            return;
        }
        let new_point = self.pruning_point();
        if new_point == self.genesis {
            return; // past(genesis) is empty: nothing to evict
        }

        // Walk the selected chain from the pruning point down, collecting each
        // chain block's mergeset and then the chain block itself, until genesis
        // or an already-evicted block. The newly evicted set is exactly the
        // blocks of `past(P_new)` still present: the chain blocks below
        // `P_new` plus the mergesets of the chain blocks walked (mergeset(P_new)
        // included, P_new itself kept). After a selected-chain reorg `P_old`
        // need not be an ancestor of `P_new`, so this is stated over the
        // already-evicted set, not over `past(P_old)`.
        let mut evicted: HashSet<BlockId> = HashSet::new();
        let mut cur = Some(new_point);
        while let Some(c) = cur {
            let node = &self.nodes[&c];
            let sp = node.ghostdag.selected_parent;
            // Evict the mergeset of the current chain block: every merged block
            // is in past(c) ⊆ past(P_new) but not in past(sp) ⊇ past(P_old), so
            // it is newly evicted and still present. This must run even when `sp`
            // is already evicted: `c` can be the present child of the previous
            // pruning point, and its mergeset (present blocks merged from off the
            // old selected chain) is then still present and must be evicted.
            if let Some(sp) = sp {
                let mergeset = self.mergeset_ordered(sp, node.block.parents());
                for m in mergeset {
                    evicted.insert(m);
                }
            }
            // Move to the selected parent: evict it unless it is genesis or
            // already evicted.
            match sp {
                None => break, // genesis: never evicted
                Some(sp) => {
                    if !self.nodes.contains_key(&sp) {
                        break; // already evicted: everything below is too
                    }
                    if sp == self.genesis {
                        break; // genesis is never evicted
                    }
                    evicted.insert(sp);
                    cur = Some(sp);
                }
            }
        }

        if evicted.is_empty() {
            return;
        }
        self.remove_blocks(&evicted);
    }

    /// Remove `evicted` blocks from the DAG: drop them from the reachability
    /// oracle (re-parenting present tree-children to genesis), from `nodes`,
    /// and from the tips. Preconditions: genesis is not in `evicted`, and the
    /// evicted set is downward-closed in the reachability tree (guaranteed by
    /// [`Dag::prune_old_blocks`] and the snapshot stub eviction).
    pub(crate) fn remove_blocks(&mut self, evicted: &HashSet<BlockId>) {
        self.reach.remove_blocks(self.genesis, evicted);
        for id in evicted {
            self.nodes.remove(id);
            self.tips.remove(id);
        }
    }

    /// The GHOSTDAG `k` parameter.
    pub fn k(&self) -> KParam {
        self.k
    }

    /// The genesis block id.
    pub fn genesis(&self) -> BlockId {
        self.genesis
    }

    /// Number of blocks in the DAG (including genesis).
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Whether the DAG only contains genesis.
    pub fn is_empty(&self) -> bool {
        self.nodes.len() <= 1
    }

    /// Whether a block is present.
    pub fn contains(&self, id: &BlockId) -> bool {
        self.nodes.contains_key(id)
    }

    /// The current tips (blocks with no children), sorted by id.
    pub fn tips(&self) -> Vec<BlockId> {
        self.tips.iter().copied().collect()
    }

    /// Borrow a stored block.
    pub fn block(&self, id: &BlockId) -> Option<&Block> {
        self.nodes.get(id).map(|n| &n.block)
    }

    /// Borrow the GHOSTDAG data derived for a block.
    pub fn ghostdag(&self, id: &BlockId) -> Option<&GhostdagData> {
        self.nodes.get(id).map(|n| &n.ghostdag)
    }

    /// `true` iff `ancestor` is a strict ancestor of `descendant`
    /// (i.e. `ancestor` is in `descendant`'s past). `false` for equal ids.
    ///
    /// Answered by the [`Reachability`] oracle in O(1)/O(fcs) rather than from a
    /// stored past set.
    pub fn is_ancestor(&self, ancestor: &BlockId, descendant: &BlockId) -> bool {
        self.reach.is_ancestor(ancestor, descendant)
    }

    /// Amortisation metrics `(reindexes, relayout_touches)` of the backing
    /// reachability oracle: how many interval reindexes its incremental
    /// maintenance has performed and how many tree nodes those reindexes touched.
    /// Pure bookkeeping that never affects a query answer — exposed so tests can
    /// prove interval reindexing stays cheaply amortised (see
    /// [`Reachability::reindex_metrics`]).
    pub fn reachability_reindex_metrics(&self) -> (u64, u64) {
        self.reach.reindex_metrics()
    }

    /// `true` iff `a` and `b` are in each other's anticone: distinct blocks
    /// where neither is an ancestor of the other (they are "parallel").
    pub fn in_anticone(&self, a: &BlockId, b: &BlockId) -> bool {
        a != b && !self.is_ancestor(a, b) && !self.is_ancestor(b, a)
    }

    /// The chain-selection key used to rank blocks: heavier blue work wins,
    /// then higher blue score, then larger id as a deterministic final tiebreak.
    ///
    /// Used to pick a block's selected parent and the DAG's selected tip.
    pub(crate) fn chain_key(&self, id: &BlockId) -> (u128, u64, BlockId) {
        let g = &self.nodes[id].ghostdag;
        (g.blue_work, g.blue_score, *id)
    }

    /// The mergeset for a block with selected parent `sp` and the given `parents`,
    /// in deterministic topological order: `past(block) \ (past(sp) ∪ {sp})`,
    /// sorted by `(past_size, id)`.
    ///
    /// Computed by a backward walk over parent edges from `parents`, bounded by
    /// `sp`'s past (a block in `past(sp) ∪ {sp}` is a boundary — not merged, and
    /// its ancestors, all also in `past(sp)`, are not traversed). Reachability is
    /// the oracle. Shared by GHOSTDAG colouring, the linearization, and
    /// [`Dag::preview`] so all three agree on the mergeset and its order.
    pub(crate) fn mergeset_ordered(&self, sp: BlockId, parents: &[BlockId]) -> Vec<BlockId> {
        let mut mergeset: Vec<BlockId> = Vec::new();
        let mut seen: HashSet<BlockId> = HashSet::new();
        let mut queue: VecDeque<BlockId> = parents.iter().copied().collect();
        while let Some(x) = queue.pop_front() {
            if !seen.insert(x) {
                continue;
            }
            if !self.nodes.contains_key(&x) {
                // Evicted block (block pruning): a boundary. The evicted set is
                // downward-closed, so its ancestors are evicted too — skip
                // without consulting the oracle (which no longer holds it).
                continue;
            }
            if x == sp || x == self.genesis || self.is_ancestor(&x, &sp) {
                // x ∈ past(sp) ∪ {sp}: boundary. Genesis is always in `past(sp)`
                // (every block descends from it), and is checked explicitly
                // because the oracle cannot answer `is_ancestor(genesis, sp)`
                // once `sp` has itself been evicted by block pruning.
                continue;
            }
            mergeset.push(x);
            for parent in self.nodes[&x].block.parents() {
                queue.push_back(*parent);
            }
        }
        // Topological order: a strict ancestor has a strictly smaller past_size.
        mergeset.sort_by_key(|b| (self.nodes[b].past_size, *b));
        mergeset
    }

    /// Enforce PoA admission rules on a prospective block (RFC-POA §4.2–4.3).
    ///
    /// 1. The block must carry an `authority_sig` that verifies (Ed25519) over
    ///    `block.hash_without_authority_sig()` against the authority scheduled
    ///    for its slot — `authorities[slot % len]` with
    ///    `slot = timestamp_ms / slot_duration_ms`.
    /// 2. The block's slot must not precede any parent's slot (slots are
    ///    monotone along every path, mirroring the difficulty timestamp rule).
    fn check_poa(&self, block: &Block, id: BlockId, poa: &PoAConfig) -> Result<(), DagError> {
        let slot = block.timestamp_ms() / poa.slot_duration_ms;

        // `work` is pinned to the nominal value: it is not a proof under PoA,
        // but the GHOSTDAG blue-work fold still consumes it, so an unpinned
        // value would let one authority steer chain selection on its own.
        // Checked before the signature so an inflated block is rejected on the
        // clearest rule, and so the rest of this function only ever reasons
        // about nominal-work blocks (RFC-POA §4 item 5).
        if block.work() != POA_NOMINAL_WORK {
            return Err(DagError::PoaWorkMismatch {
                id,
                expected: POA_NOMINAL_WORK,
                actual: block.work(),
            });
        }

        // Authority signature must be present and verify against the authority
        // scheduled for the block's slot, over the hash without the signature.
        let sig = block
            .authority_sig()
            .ok_or_else(|| DagError::InvalidAuthoritySignature {
                id,
                reason: "missing authority signature".to_string(),
            })?;
        let message = block.hash_without_authority_sig();
        poa.authority_set
            .verify_slot_signature(slot, message.as_bytes(), sig)
            .map_err(|e| DagError::InvalidAuthoritySignature {
                id,
                reason: format!("slot {slot}: {e}"),
            })?;

        // Slot consistency: the block's slot must not precede any parent's.
        for parent in block.parents() {
            let parent_ts = self.nodes[parent].block.timestamp_ms();
            let parent_slot = parent_ts / poa.slot_duration_ms;
            if slot < parent_slot {
                return Err(DagError::InvalidAuthoritySignature {
                    id,
                    reason: format!(
                        "slot {slot} precedes parent slot {parent_slot} (parent {parent})"
                    ),
                });
            }
        }

        Ok(())
    }

    /// Preview the GHOSTDAG selected parent and mergeset a block would get if it
    /// were inserted with `block`'s parents — **without** inserting it.
    ///
    /// Runs the same structural checks as [`Dag::insert`] (duplicate, no parents,
    /// missing parent) so a caller can validate a prospective block against its
    /// view before committing it. This is what lets the state layer apply a
    /// block's transactions on top of its selected parent's UTXO state and reject
    /// an invalid block before it enters the DAG.
    pub fn preview(&self, block: &Block) -> Result<BlockPreview, DagError> {
        let id = block.id();
        if self.nodes.contains_key(&id) {
            return Err(DagError::DuplicateBlock(id));
        }
        if block.parents().is_empty() {
            return Err(DagError::NoParents(id));
        }
        for parent in block.parents() {
            if !self.nodes.contains_key(parent) {
                return Err(DagError::MissingParent(*parent));
            }
        }
        let selected_parent = *block
            .parents()
            .iter()
            .max_by_key(|p| self.chain_key(p))
            .expect("non-empty parents");
        let mergeset = self.mergeset_ordered(selected_parent, block.parents());
        Ok(BlockPreview {
            selected_parent,
            mergeset,
        })
    }

    /// Insert `block`, validating and colouring it. Returns its id.
    ///
    /// Fails if the block is a duplicate, references a missing parent, (for a
    /// non-genesis block) references no parents, is rejected by the installed
    /// [`BlockValidator`] (if any), or carries a `work` that disagrees with the
    /// PoA nominal constant, or a timestamp that
    /// precedes a parent's. The structural DAG checks run first, so a validator
    /// only ever sees a block whose parents are present.
    pub fn insert(&mut self, block: Block) -> Result<BlockId, DagError> {
        self.insert_with_id(block, None)
    }

    /// Insert `block` with an optional pre-computed `id`. If `id` is `Some`,
    /// it is used instead of `block.id()` — this is needed for restoring
    /// pruned blocks from snapshots where the block's payload is empty and
    /// `block.id()` would differ from the original.
    pub fn insert_with_id(
        &mut self,
        block: Block,
        id: Option<BlockId>,
    ) -> Result<BlockId, DagError> {
        self.insert_with_id_inner(block, id, false)
    }

    /// Like [`insert_with_id`], but skips the block-pruning invariant check
    /// (`BuildsOnPrunedHistory`). Used during log/snapshot replay where the
    /// block is known-valid history and its parents may lie in the pruned
    /// region (e.g., anticone blocks linearized last). Because this bypasses
    /// design (A+), a replay must not run with a finite `block_pruning_depth`
    /// (RFC-009 R8).
    pub fn insert_for_replay(
        &mut self,
        block: Block,
        id: Option<BlockId>,
    ) -> Result<BlockId, DagError> {
        self.insert_with_id_inner(block, id, true)
    }

    fn insert_with_id_inner(
        &mut self,
        block: Block,
        id: Option<BlockId>,
        skip_pruning_check: bool,
    ) -> Result<BlockId, DagError> {
        let id = id.unwrap_or_else(|| block.id());
        if self.nodes.contains_key(&id) {
            return Err(DagError::DuplicateBlock(id));
        }
        if block.parents().is_empty() {
            return Err(DagError::NoParents(id));
        }
        for parent in block.parents() {
            if !self.nodes.contains_key(parent) {
                return Err(DagError::MissingParent(*parent));
            }
        }

        // Payload-aware validation, before the block is added to the DAG. Both
        // borrows of `self` here are shared, which the borrow checker allows.
        if let Some(validator) = self.validator.as_deref() {
            validator
                .validate(&block, self)
                .map_err(|reason| DagError::InvalidBlock { id, reason })?;
        }

        // Derive GHOSTDAG data (selected parent, mergeset, colouring) against the
        // oracle as it stands before this block is added.
        let ghostdag = self.compute_ghostdag(block.parents());

        // past_size(B) = past_size(sp) + 1 + |mergeset(B)| (a disjoint union).
        let sp = ghostdag
            .selected_parent
            .expect("non-genesis has a selected parent");

        // Consensus-enforced difficulty, if enabled: the block's timestamp must
        // Consensus-enforced Proof-of-Authority, if enabled (RFC-POA §4).
        // Skipped on replay — replayed blocks are trusted history whose
        // signatures may come from an earlier authority set.
        if !skip_pruning_check {
            if let Some(poa) = &self.poa {
                self.check_poa(&block, id, poa)?;
            }
        }

        // Block-pruning invariant, if enabled: **every** parent of the new block
        // and **every mergeset candidate** must be in future(P) ∪ {P}
        // (P = pruning point). Checked before the block is wired in, so a rejected
        // block leaves the DAG unchanged.
        //
        // RFC-009 design (A+). Checking only the parents is NOT sufficient: an
        // `anticone(P)` block can be an *ancestor* of a `future(P)` parent and still
        // surface as a mergeset candidate. A differential search over DAGs whose
        // parents are all in `future(P) ∪ {P}` found 344/8000 divergences with the
        // parent-only check and 0/8000 once candidates are checked too (§14).
        //
        // Why candidates are the tight condition: design (B1)'s bounded
        // `blue_anticone_sizes` drops `past(P)` keys, which is exact exactly when
        // every candidate `c` lies in `future(P) ∪ {P}` — then every `past(P)` blue
        // `b` satisfies `b ∈ past(P) ⊆ past(c)` (for `c ∈ future(P)`), so `b` is in
        // `c`'s past, not its anticone, and `try_colour_blue` treats it as inert.
        // An `anticone(P)` candidate instead has genuine `past(P)` blues in its
        // anticone that the drop removes, under-counting it and colouring it blue
        // where an unpruned node colours it red (the confirmed §13 counterexample).
        //
        // The candidate set is `mergeset_blues ∪ mergeset_reds` from the colouring
        // computed above; it comes from `mergeset_ordered` (reachability), so the
        // (B1) trim changes only the blue/red split, never the set. The parent loop
        // additionally pins the selected parent (which is not itself a candidate) to
        // `future(P) ∪ {P}`, so the inherited map comes from a valid future block.
        // See `docs/RFC-009-DESIGN-ANALYSIS.md` §13-§14.
        if !skip_pruning_check && self.block_pruning_depth != u64::MAX {
            let p = self.pruning_point();
            for parent in block.parents() {
                if *parent != p && !self.is_ancestor(&p, parent) {
                    return Err(DagError::BuildsOnPrunedHistory { id });
                }
            }
            for c in ghostdag
                .mergeset_blues
                .iter()
                .chain(&ghostdag.mergeset_reds)
            {
                if *c != p && !self.is_ancestor(&p, c) {
                    return Err(DagError::BuildsOnPrunedHistory { id });
                }
            }
        }

        let past_size = self.nodes[&sp].past_size
            + 1
            + (ghostdag.mergeset_blues.len() + ghostdag.mergeset_reds.len()) as u64;

        // The full mergeset (blues + reds), captured before `ghostdag` is moved
        // into the node — this is what the oracle needs to update its
        // future-covering sets.
        let mergeset: Vec<BlockId> = ghostdag
            .mergeset_blues
            .iter()
            .chain(&ghostdag.mergeset_reds)
            .copied()
            .collect();

        // Wire the block in: attach to parents, refresh tips.
        for parent in block.parents() {
            self.nodes.get_mut(parent).unwrap().children.insert(id);
            self.tips.remove(parent);
        }
        self.tips.insert(id);

        self.nodes.insert(
            id,
            Node {
                block,
                past_size,
                children: BTreeSet::new(),
                ghostdag,
            },
        );

        // Fold the one new block into the reachability oracle incrementally
        // (Kaspa reachability / interval reindexing), rather than rebuilding it.
        self.reach.add_block(id, sp, &mergeset);

        // Evict payloads of blocks that are now beyond the pruning depth.
        if self.payload_pruning_depth != u64::MAX {
            self.prune_old_payloads();
        }

        // Evict blocks that are now beyond the block pruning depth.
        if self.block_pruning_depth != u64::MAX {
            self.prune_old_blocks();
        }

        Ok(id)
    }
}
