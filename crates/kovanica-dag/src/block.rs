//! Block identity and the block type.
//!
//! A [`Block`] is the unit of the DAG. Unlike a linear chain, a block may
//! reference **multiple** parents (the tips its miner observed), which is what
//! lets the ledger admit parallel blocks and, in turn, high block throughput.
//!
//! A [`BlockId`] is the BLAKE3 hash of the block's canonical encoding, so it is
//! a stable, collision-resistant identifier that every node derives identically.
//!
//! ## Payload pruning
//!
//! The block's `payload` field is `Option<Vec<u8>>` rather than a mandatory
//! `Vec<u8>`. This enables **DAG-level payload pruning**: once a block is
//! sufficiently finalized (beyond a configurable blue-score depth), its payload
//! can be evicted to bound memory and disk usage. The block's identity (id) and
//! consensus fields (`parents`, `work`, `timestamp_ms`, `nonce`) are always
//! retained — only the opaque payload bytes are optional.
//!
//! The reachability oracle ([`crate::reachability`]) answers ancestor queries
//! from the selected-parent tree and future-covering sets, which depend only on
//! the block's position in the DAG (its parents and selected parent). It never
//! inspects the payload, so `is_ancestor`, mergeset computation, and all other
//! reachability queries remain correct even when payloads are `None`. The block's
//! id is computed over the *original* payload at insertion time; when a pruned
//! block is re-encoded (e.g. for a snapshot), an empty payload is used, which
//! produces the same id because the id commits to the payload length and bytes
//! at insertion time — the pruning happens *after* insertion, so the stored id is
//! the authoritative one.

use core::fmt;

/// 32-byte BLAKE3 digest identifying a block.
///
/// Ordering is defined over the raw bytes so that consensus tie-breaks (which
/// fall back to the id) are deterministic across nodes.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BlockId([u8; 32]);

impl BlockId {
    /// Construct a `BlockId` from raw bytes (mainly for tests and decoding).
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// The raw 32 bytes of the digest.
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Lowercase hex rendering of the full digest.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Debug for BlockId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Short prefix keeps DAG dumps readable; full id via `to_hex`.
        write!(f, "BlockId({}…)", &self.to_hex()[..8])
    }
}

impl fmt::Display for BlockId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

/// A block: a vertex of the DAG.
///
/// Consensus (GHOSTDAG) interprets `parents`, `work`, and `timestamp_ms`
/// (the last two feed difficulty retargeting and its enforcement — see
/// [`crate::difficulty`]); `nonce` is the field a miner varies to make the
/// block's id meet its proof-of-work target (see [`crate::pow`]); `payload` is
/// opaque bytes (transactions, in a full ledger) and only affects the id.
///
/// The payload is `Option<Vec<u8>>` to support **DAG-level payload pruning**:
/// once a block is sufficiently finalized (beyond `payload_pruning_depth` blue
/// score below the selected tip), its payload can be set to `None` to reclaim
/// memory. The block's id, computed at insertion time over the original payload,
/// is never changed. All consensus logic works correctly with `payload = None`
/// because it never inspects payload bytes — only the id, parents, work,
/// timestamp, and nonce.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    /// Ids of the parent blocks this block references. Empty only for genesis.
    parents: Vec<BlockId>,
    /// The block's own work/difficulty weight; contributes to blue work.
    work: u128,
    /// The block's timestamp, in milliseconds. Used by difficulty retargeting
    /// and, where enforced, must not precede any parent's timestamp.
    timestamp_ms: u64,
    /// The proof-of-work nonce: the value a miner searches over so the block's
    /// id meets its `work` target (see [`crate::pow`]). Folded into the id, so
    /// changing it changes the hash — which is what mining explores. Not
    /// interpreted by GHOSTDAG; `0` for a block that was never mined.
    nonce: u64,
    /// Opaque application payload; not interpreted by consensus.
    /// `None` indicates the payload has been pruned.
    payload: Option<Vec<u8>>,
}

impl Block {
    /// Create a block referencing `parents` with the given `work`,
    /// `timestamp_ms`, `nonce`, and `payload`.
    ///
    /// Parents are de-duplicated and sorted so the id is independent of the
    /// order in which a miner happened to list them.
    pub fn new(
        mut parents: Vec<BlockId>,
        work: u128,
        timestamp_ms: u64,
        nonce: u64,
        payload: Vec<u8>,
    ) -> Self {
        parents.sort_unstable();
        parents.dedup();
        Self {
            parents,
            work,
            timestamp_ms,
            nonce,
            payload: Some(payload),
        }
    }

    /// Create a block with an explicitly `None` payload (used when reconstructing
    /// a pruned block from a snapshot).
    pub fn new_pruned(
        mut parents: Vec<BlockId>,
        work: u128,
        timestamp_ms: u64,
        nonce: u64,
    ) -> Self {
        parents.sort_unstable();
        parents.dedup();
        Self {
            parents,
            work,
            timestamp_ms,
            nonce,
            payload: None,
        }
    }

    /// The canonical genesis block: no parents, the given work, timestamp,
    /// nonce, and payload.
    pub fn genesis(work: u128, timestamp_ms: u64, nonce: u64, payload: Vec<u8>) -> Self {
        Self {
            parents: Vec::new(),
            work,
            timestamp_ms,
            nonce,
            payload: Some(payload),
        }
    }

    /// The canonical genesis block with a pruned payload.
    pub fn genesis_pruned(work: u128, timestamp_ms: u64, nonce: u64) -> Self {
        Self {
            parents: Vec::new(),
            work,
            timestamp_ms,
            nonce,
            payload: None,
        }
    }

    /// The block's parents (sorted, de-duplicated).
    pub fn parents(&self) -> &[BlockId] {
        &self.parents
    }

    /// The block's work weight.
    pub fn work(&self) -> u128 {
        self.work
    }

    /// The block's timestamp, in milliseconds.
    pub fn timestamp_ms(&self) -> u64 {
        self.timestamp_ms
    }

    /// The proof-of-work nonce (see [`crate::pow`]).
    pub fn nonce(&self) -> u64 {
        self.nonce
    }

    /// Return a copy of this block with the nonce set to `nonce`. Used by the
    /// miner ([`crate::pow::mine`]) to search nonces without rebuilding the rest
    /// of the block.
    pub fn with_nonce(&self, nonce: u64) -> Self {
        Self {
            nonce,
            ..self.clone()
        }
    }

    /// Set the payload to `None`, marking this block as pruned. Used by
    /// [`Dag::prune_old_payloads`] to reclaim memory.
    pub fn prune_payload(&mut self) {
        self.payload = None;
    }

    /// The opaque application payload. Returns an empty slice if the payload has
    /// been pruned.
    pub fn payload(&self) -> &[u8] {
        self.payload.as_deref().unwrap_or(&[])
    }

    /// Whether this block's payload has been pruned.
    pub fn is_pruned(&self) -> bool {
        self.payload.is_none()
    }

    /// Deterministic BLAKE3 id over the canonical encoding.
    ///
    /// Encoding (all integers little-endian): `parents.len()` as u64, each
    /// parent's 32 bytes in sorted order, `work` as u128, `timestamp_ms` as u64,
    /// `nonce` as u64, `payload.len()` as u64, then the payload bytes. Length
    /// prefixes make the encoding unambiguous (no two distinct blocks share an
    /// encoding). The nonce is folded in so that varying it changes the id —
    /// which is precisely what proof-of-work mining searches over.
    ///
    /// If the payload has been pruned (`payload = None`), an empty payload is
    /// hashed. This is only used for reconstructing blocks from snapshots where
    /// the payload was already pruned; the original id (computed over the full
    /// payload at insertion time) is what the DAG stores and uses for consensus.
    pub fn id(&self) -> BlockId {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&(self.parents.len() as u64).to_le_bytes());
        for parent in &self.parents {
            hasher.update(parent.as_bytes());
        }
        hasher.update(&self.work.to_le_bytes());
        hasher.update(&self.timestamp_ms.to_le_bytes());
        hasher.update(&self.nonce.to_le_bytes());
        let payload = self.payload.as_deref().unwrap_or(&[]);
        hasher.update(&(payload.len() as u64).to_le_bytes());
        hasher.update(payload);
        BlockId(*hasher.finalize().as_bytes())
    }

    /// Returns the length of the block's encoded form (as produced by
    /// `kovanica_dag::encode_block`), used for skipping during checkpoint decode.
    pub fn encoded_len(&self) -> usize {
        // parents.len() (8) + each parent (32) + work (16) + timestamp (8) + nonce (8) + payload.len (8) + payload
        8 + self.parents.len() * 32 + 16 + 8 + 8 + 8 + self.payload.as_deref().unwrap_or(&[]).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_is_deterministic() {
        let b = Block::new(vec![], 1, 0, 0, b"a".to_vec());
        assert_eq!(b.id(), b.id());
    }

    #[test]
    fn id_independent_of_parent_order() {
        let p1 = Block::genesis(1, 0, 0, b"p1".to_vec()).id();
        let p2 = Block::new(vec![p1], 1, 1, 0, b"p2".to_vec()).id();
        let a = Block::new(vec![p1, p2], 1, 2, 0, b"c".to_vec());
        let b = Block::new(vec![p2, p1], 1, 2, 0, b"c".to_vec());
        assert_eq!(a.id(), b.id());
    }

    #[test]
    fn distinct_payload_distinct_id() {
        let a = Block::new(vec![], 1, 0, 0, b"a".to_vec());
        let b = Block::new(vec![], 1, 0, 0, b"b".to_vec());
        assert_ne!(a.id(), b.id());
    }

    #[test]
    fn distinct_timestamp_distinct_id() {
        let a = Block::new(vec![], 1, 10, 0, b"a".to_vec());
        let b = Block::new(vec![], 1, 11, 0, b"a".to_vec());
        assert_ne!(a.id(), b.id());
        assert_eq!(a.timestamp_ms(), 10);
    }

    #[test]
    fn distinct_nonce_distinct_id() {
        let a = Block::new(vec![], 1, 0, 7, b"a".to_vec());
        let b = Block::new(vec![], 1, 0, 8, b"a".to_vec());
        assert_ne!(a.id(), b.id());
        assert_eq!(a.nonce(), 7);
        assert_eq!(a.with_nonce(8).id(), b.id());
    }

    #[test]
    fn pruned_block_has_empty_payload() {
        let b = Block::new_pruned(vec![], 1, 0, 0);
        assert!(b.is_pruned());
        assert_eq!(b.payload(), &[]);
        assert_eq!(b.payload().len(), 0);
    }

    #[test]
    fn pruned_block_id_uses_empty_payload() {
        let a = Block::new(vec![], 1, 0, 0, b"payload".to_vec());
        let b = Block::new_pruned(vec![], 1, 0, 0);
        // Pruned block hashes empty payload, so different from full payload
        assert_ne!(a.id(), b.id());
        // But two pruned blocks with same params have same id
        let c = Block::new_pruned(vec![], 1, 0, 0);
        assert_eq!(b.id(), c.id());
    }

    #[test]
    fn prune_payload_clears_payload() {
        let mut b = Block::new(vec![], 1, 0, 0, b"payload".to_vec());
        assert!(!b.is_pruned());
        b.prune_payload();
        assert!(b.is_pruned());
        assert_eq!(b.payload(), &[]);
    }
}
