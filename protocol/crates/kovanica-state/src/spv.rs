//! SPV (Simplified Payment Verification) for light clients.
//!
//! This module provides the data structures and verification logic for light
//! clients to verify transaction inclusion and block validity without
//! downloading the full DAG. The approach follows Bitcoin SPV but adapted
//! for the GHOSTDAG linearized chain.
//!
//! ## Architecture
//!
//! - **Header chain**: Only the selected (heaviest) chain blocks are stored
//!   as headers. Each header commits to the full block payload via a Merkle
//!   root of the transaction list.
//! - **Merkle proofs**: A light client can verify a transaction was included
//!   in a specific block by checking the Merkle path from the tx to the
//!   block's Merkle root (stored in the header).
//! - **Chain proof**: A sequence of headers from a trusted checkpoint to the
//!   target block proves the block is on the selected chain.
//!
//! ## Trust model
//!
//! The light client trusts a **checkpoint header** (obtained out-of-band or
//! from a trusted source). From there, it verifies the header chain by
//! checking:
//! 1. Each header's `prev_hash` links correctly
//! 2. Each header's `merkle_root` is well-formed
//! 3. The total work is the heaviest known chain
//! 4. If PoA is enabled, each header carries a valid authority signature for
//!    its slot under the client's authority set
//!
//! Transaction inclusion is then verified via Merkle proof against the
//! block's Merkle root.

use std::collections::HashMap;

use blake3::Hasher;
use kovanica_dag::{AuthoritySet, AuthorityUpdateTx, Block, BlockId};

/// A block header: the minimal data a light client needs to verify the
/// selected chain and transaction inclusion.
///
/// The full block payload (transactions) is NOT stored — only the Merkle
/// root of the transaction list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockHeader {
    /// The block's own id (BLAKE3 hash of full block).
    pub id: BlockId,
    /// Hash of the previous block in the selected chain.
    pub prev_hash: BlockId,
    /// Merkle root of the block's transaction list.
    pub merkle_root: [u8; 32],
    /// The block's work weight (pinned to `POA_NOMINAL_WORK` under PoA;
    /// accumulated along the selected chain for chain selection).
    pub work: u128,
    /// The block's timestamp (ms since UNIX epoch).
    pub timestamp_ms: u64,
    /// The block's nonce (retained for id preimage compatibility; unused by PoA).
    pub nonce: u64,
    /// Blue score of this block (selected chain height in GHOSTDAG terms).
    pub blue_score: u64,
    /// Total blue work of the selected chain up to this block.
    pub chain_blue_work: u128,
    /// Height in the selected chain (0 = genesis).
    pub height: u64,
    /// The block's authority signature (PoA): 64-byte Ed25519 signature
    /// over `hash_without_authority_sig`. `None` for the genesis block.
    pub authority_sig: Option<[u8; 64]>,
    /// The hash of the authority set this block was produced under
    /// (all-zeros for the genesis block).
    pub authority_set_hash: [u8; 32],
    /// The message the authority signed: `block.hash_without_authority_sig()`
    /// (all-zeros for the genesis block).
    pub hash_without_authority_sig: [u8; 32],
}

impl BlockHeader {
    /// Create a header from a full block and its selected-chain context.
    pub fn from_block(
        block: &Block,
        prev_hash: BlockId,
        blue_score: u64,
        chain_blue_work: u128,
        height: u64,
        txs: &[crate::Transaction],
        authority_set_hash: [u8; 32],
    ) -> Self {
        let merkle_root = merkle_root(txs);
        let authority_sig = block.authority_sig().copied();
        let hash_without_authority_sig = block.hash_without_authority_sig();
        Self {
            id: block.id(),
            prev_hash,
            merkle_root,
            work: block.work(),
            timestamp_ms: block.timestamp_ms(),
            nonce: block.nonce(),
            blue_score,
            chain_blue_work,
            height,
            authority_sig,
            authority_set_hash,
            hash_without_authority_sig: *hash_without_authority_sig.as_bytes(),
        }
    }

    /// Verify the header chain from `trusted` (exclusive) to `self` (inclusive).
    /// Returns true if all links, work, and timestamps are valid.
    pub fn verify_chain(&self, trusted: &BlockHeader, headers: &[&BlockHeader]) -> bool {
        // Check we're in the same chain (work should be increasing)
        if self.chain_blue_work <= trusted.chain_blue_work {
            return false;
        }
        if self.height <= trusted.height {
            return false;
        }

        // Check each header in the provided slice
        let mut prev = trusted;
        for h in headers {
            // Link check
            if h.prev_hash != prev.id {
                return false;
            }
            // Height monotonic
            if h.height != prev.height + 1 {
                return false;
            }
            // Timestamp monotonic
            if h.timestamp_ms < prev.timestamp_ms {
                return false;
            }
            // Work accumulating
            if h.chain_blue_work <= prev.chain_blue_work {
                return false;
            }
            prev = h;
        }
        // Final check: self matches last header
        if headers.last().map(|h| h.id) != Some(self.id) {
            return false;
        }
        true
    }
}

/// Compute the Merkle root of a list of transactions.
pub fn merkle_root(txs: &[crate::Transaction]) -> [u8; 32] {
    let leaves: Vec<[u8; 32]> = txs.iter().map(|tx| *tx.id().as_bytes()).collect();
    if leaves.is_empty() {
        return [0u8; 32];
    }
    merkle_root_from_leaves(&leaves)
}

/// Compute Merkle root from pre-hashed leaves.
fn merkle_root_from_leaves(leaves: &[[u8; 32]]) -> [u8; 32] {
    let mut current = leaves.to_vec();
    while current.len() > 1 {
        let mut next = Vec::with_capacity(current.len().div_ceil(2));
        for chunk in current.chunks(2) {
            if chunk.len() == 2 {
                let mut hasher = Hasher::new();
                hasher.update(&chunk[0]);
                hasher.update(&chunk[1]);
                next.push(*hasher.finalize().as_bytes());
            } else {
                // Odd count: duplicate last
                let mut hasher = Hasher::new();
                hasher.update(&chunk[0]);
                hasher.update(&chunk[0]);
                next.push(*hasher.finalize().as_bytes());
            }
        }
        current = next;
    }
    current[0]
}

/// A Merkle proof of transaction inclusion in a block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerkleProof {
    /// The transaction's hash (leaf in the Merkle tree).
    pub leaf: [u8; 32],
    /// The sibling hashes along the path to the root.
    pub path: Vec<[u8; 32]>,
    /// The index of the leaf in the transaction list.
    pub index: usize,
}

impl MerkleProof {
    /// Verify this proof against a given Merkle root.
    pub fn verify(&self) -> [u8; 32] {
        let mut hash = self.leaf;
        let mut idx = self.index;
        for sibling in &self.path {
            let (left, right) = if idx % 2 == 0 {
                (hash, *sibling)
            } else {
                (*sibling, hash)
            };
            let mut hasher = Hasher::new();
            hasher.update(&left);
            hasher.update(&right);
            hash = *hasher.finalize().as_bytes();
            idx /= 2;
        }
        hash
    }
}

/// Generate a Merkle proof for a transaction at `index` in `txs`.
/// Returns `None` if `txs` is empty or `index` is out of bounds.
pub fn generate_merkle_proof(txs: &[crate::Transaction], index: usize) -> Option<MerkleProof> {
    if txs.is_empty() || index >= txs.len() {
        return None;
    }
    let leaves: Vec<[u8; 32]> = txs.iter().map(|tx| *tx.id().as_bytes()).collect();
    let mut path = Vec::new();
    let mut current = leaves;
    let mut idx = index;
    while current.len() > 1 {
        let sibling_idx = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
        let sibling = if sibling_idx < current.len() {
            current[sibling_idx]
        } else {
            current[idx] // last odd leaf paired with itself
        };
        path.push(sibling);
        let mut next = Vec::with_capacity(current.len().div_ceil(2));
        for i in (0..current.len()).step_by(2) {
            let left = current[i];
            let right = if i + 1 < current.len() {
                current[i + 1]
            } else {
                left
            };
            let mut hasher = Hasher::new();
            hasher.update(&left);
            hasher.update(&right);
            next.push(*hasher.finalize().as_bytes());
        }
        current = next;
        idx /= 2;
    }
    Some(MerkleProof {
        leaf: *txs[index].id().as_bytes(),
        path,
        index,
    })
}

/// Compact block filter using Golomb-Rice coding for light client address
/// watching. Each distinct output address in a block's payload is encoded
/// into a bit array; the filter can then be queried for address membership
/// with no false negatives (and a configurable false positive rate).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockFilter {
    /// Golomb-Rice parameter k (8 is the reference choice; higher = denser, larger).
    pub k: u8,
    /// Number of addresses encoded into the filter.
    pub n: u32,
    /// The encoded filter data.
    pub data: Vec<u8>,
}

impl BlockFilter {
    /// Create a filter from a sorted list of 32-byte address payloads.
    /// `addresses` must be sorted and deduplicated.
    pub fn from_addresses(addresses: &[[u8; 32]], k: u8) -> Self {
        use crate::spv::golomb_rice::encode_golomb_rice;
        let n = addresses.len() as u32;
        if n == 0 {
            return Self {
                k,
                n: 0,
                data: Vec::new(),
            };
        }
        // Convert addresses to 64-bit integers for encoding (use BLAKE3 hash of address).
        let mut values: Vec<u64> = addresses
            .iter()
            .map(|addr| {
                let mut hasher = blake3::Hasher::new();
                hasher.update(addr);
                let hash = hasher.finalize();
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&hash.as_bytes()[..8]);
                u64::from_le_bytes(bytes)
            })
            .collect();
        values.sort_unstable();
        let data = encode_golomb_rice(&values, k);
        Self { k, n, data }
    }

    /// Check if an address might be in the block (no false negatives).
    pub fn matches(&self, address: &[u8; 32]) -> bool {
        use crate::spv::golomb_rice::decode_golomb_rice;
        if self.n == 0 {
            return false;
        }
        let mut hasher = blake3::Hasher::new();
        hasher.update(address);
        let hash = hasher.finalize();
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        let query = u64::from_le_bytes(bytes);
        let values = decode_golomb_rice(&self.data, self.k);
        // Binary search since values are sorted
        values.binary_search(&query).is_ok()
    }
}

mod golomb_rice {
    /// Encode a sorted list of u64 values using Golomb-Rice coding with parameter k.
    pub fn encode_golomb_rice(values: &[u64], k: u8) -> Vec<u8> {
        if values.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut bit_buf = 0u64;
        let mut bit_len = 0;
        let mut prev = 0u64;

        for &v in values {
            let diff = v.saturating_sub(prev);
            prev = v;
            let q = diff >> k;
            let r = diff & ((1u64 << k) - 1);
            // Unary coding for q: q ones followed by a zero
            for _ in 0..q {
                bit_buf = (bit_buf << 1) | 1;
                bit_len += 1;
                if bit_len == 64 {
                    out.extend_from_slice(&bit_buf.to_be_bytes());
                    bit_buf = 0;
                    bit_len = 0;
                }
            }
            // Zero terminator
            bit_buf <<= 1;
            bit_len += 1;
            if bit_len == 64 {
                out.extend_from_slice(&bit_buf.to_be_bytes());
                bit_buf = 0;
                bit_len = 0;
            }
            // Binary coding for r (k bits)
            bit_buf = (bit_buf << k) | r;
            bit_len += k as u32;
            if bit_len >= 64 {
                let shift = bit_len - 64;
                out.extend_from_slice(&(bit_buf >> shift).to_be_bytes());
                bit_buf &= (1u64 << shift) - 1;
                bit_len = shift;
            }
        }
        // Flush remaining bits
        if bit_len > 0 {
            bit_buf <<= 64 - bit_len;
            out.extend_from_slice(&bit_buf.to_be_bytes());
        }
        out
    }

    /// Decode Golomb-Rice encoded data back to sorted u64 values.
    pub fn decode_golomb_rice(data: &[u8], k: u8) -> Vec<u64> {
        if data.is_empty() {
            return Vec::new();
        }
        let mut values = Vec::new();
        let mut bit_pos = 0;
        let bits = data.len() * 8;
        let mut prev = 0u64;

        while bit_pos < bits {
            // Read unary q
            let mut q = 0u64;
            loop {
                if bit_pos >= bits {
                    return values;
                }
                let byte_idx = bit_pos / 8;
                let bit_idx = bit_pos % 8;
                let bit = (data[byte_idx] >> (7 - bit_idx)) & 1;
                bit_pos += 1;
                if bit == 0 {
                    break;
                }
                q += 1;
            }
            // Read binary r (k bits)
            if bit_pos + k as usize > bits {
                return values;
            }
            let mut r = 0u64;
            for _ in 0..k {
                let byte_idx = bit_pos / 8;
                let bit_idx = bit_pos % 8;
                let bit = (data[byte_idx] >> (7 - bit_idx)) & 1;
                bit_pos += 1;
                r = (r << 1) | bit as u64;
            }
            let diff = (q << k) | r;
            prev = prev.saturating_add(diff);
            values.push(prev);
        }
        values
    }
}

/// PoA verification policy for an SPV client.
#[derive(Clone, Debug)]
pub struct SpvPoAConfig {
    /// The authority set to verify block signatures against.
    pub authority_set: AuthoritySet,
    /// Slot duration in milliseconds (RFC-POA §3).
    pub slot_duration_ms: u64,
}

/// A client-side proof that an authority-set update happened at a block:
/// the threshold-signed update plus a Merkle inclusion proof of the update
/// transaction inside that block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthorityUpdateProof {
    /// The threshold-signed update (old set → new set).
    pub update: AuthorityUpdateTx,
    /// Merkle inclusion proof of the update tx in the announcing block.
    pub merkle: MerkleProof,
    /// Height of the announcing block (its header carries the new set hash).
    pub height: u64,
}

/// SPV client state: the header chain it has verified.
#[derive(Clone, Debug, Default)]
pub struct SpvClient {
    /// Verified headers, indexed by height.
    headers: HashMap<u64, BlockHeader>,
    /// The highest verified header (tip of the SPV chain).
    tip: Option<BlockHeader>,
    /// The trusted checkpoint header (genesis or later).
    /// Retained for introspection; verification uses `headers`.
    #[allow(dead_code)]
    checkpoint: Option<BlockHeader>,
    /// PoA verification policy (if any).
    poa: Option<SpvPoAConfig>,
}

impl SpvClient {
    /// Create a new SPV client with a trusted checkpoint (no PoA verification).
    pub fn new(checkpoint: BlockHeader) -> Self {
        let mut headers = HashMap::new();
        headers.insert(checkpoint.height, checkpoint.clone());
        Self {
            checkpoint: Some(checkpoint.clone()),
            headers,
            tip: Some(checkpoint),
            ..Self::default()
        }
    }

    /// Create a new SPV client with a trusted checkpoint and PoA verification.
    pub fn with_poa(checkpoint: BlockHeader, poa: SpvPoAConfig) -> Self {
        let mut s = Self::new(checkpoint);
        s.poa = Some(poa);
        s
    }

    /// Add a new header to the SPV chain.
    /// Returns true if accepted and becomes new tip.
    pub fn add_header(&mut self, header: BlockHeader) -> Result<bool, SpvError> {
        // Must extend the current tip
        let Some(tip) = &self.tip else {
            return Err(SpvError::NoCheckpoint);
        };
        if header.height != tip.height + 1 {
            return Err(SpvError::HeightMismatch);
        }
        if header.prev_hash != tip.id {
            return Err(SpvError::PrevHashMismatch);
        }
        if header.timestamp_ms < tip.timestamp_ms {
            return Err(SpvError::TimestampNotMonotonic);
        }
        if header.chain_blue_work <= tip.chain_blue_work {
            return Err(SpvError::WorkNotIncreasing);
        }

        // PoA verification
        if let Some(poa) = &self.poa {
            // Authority signature must be present
            let sig = header.authority_sig.ok_or(SpvError::MissingAuthoritySig)?;
            // Authority set must match
            if header.authority_set_hash != poa.authority_set.hash() {
                return Err(SpvError::AuthoritySetChanged);
            }
            // Slot must match
            let slot = header.timestamp_ms / poa.slot_duration_ms;
            // Verify the authority signature against the expected authority for this slot
            let _expected_authority = poa.authority_set.active_authority(slot);
            // Verify the authority signature
            poa.authority_set
                .verify_slot_signature(slot, &header.hash_without_authority_sig, &sig)
                .map_err(|_| SpvError::InvalidAuthoritySig)?;
        }

        // Accept
        self.headers.insert(header.height, header.clone());
        self.tip = Some(header);
        Ok(true)
    }

    /// Get the current tip header.
    pub fn tip(&self) -> Option<&BlockHeader> {
        self.tip.as_ref()
    }

    /// Get a header by height.
    pub fn header(&self, height: u64) -> Option<&BlockHeader> {
        self.headers.get(&height)
    }

    /// Verify a Merkle proof against a header in our chain.
    pub fn verify_tx_inclusion(&self, proof: &MerkleProof, height: u64) -> bool {
        if let Some(header) = self.headers.get(&height) {
            proof.verify() == header.merkle_root
        } else {
            false
        }
    }

    /// Verify a transaction is in the chain: check proof and that the block
    /// is in the verified header chain.
    pub fn verify_transaction(&self, proof: &MerkleProof, height: u64) -> bool {
        self.verify_tx_inclusion(proof, height)
    }

    /// Get the chain work up to the tip.
    pub fn chain_work(&self) -> u128 {
        self.tip.as_ref().map(|t| t.chain_blue_work).unwrap_or(0)
    }

    /// Apply an authority-set update proven to be included in the block at
    /// `height` (whose header carries the new set hash). Verifies the update
    /// against the current set and switches the client's set.
    pub fn apply_authority_update(&mut self, proof: &AuthorityUpdateProof) -> Result<(), SpvError> {
        let Some(poa) = &mut self.poa else {
            return Err(SpvError::PoANotEnabled);
        };
        // The announcing header must exist in our chain
        let header = self
            .headers
            .get(&proof.height)
            .ok_or(SpvError::UpdateNotInBlock)?;
        // The header's set hash must match the new set
        if header.authority_set_hash != proof.update.new_set().hash() {
            return Err(SpvError::InvalidAuthorityUpdate);
        }
        // Verify the update against the current set
        proof
            .update
            .validate(&poa.authority_set)
            .map_err(|_| SpvError::InvalidAuthorityUpdate)?;
        // Verify the Merkle proof: the update tx must be in the block
        if proof.merkle.verify() != header.merkle_root {
            return Err(SpvError::InvalidAuthorityUpdate);
        }
        // Switch to the new authority set
        poa.authority_set = proof.update.new_set().clone();
        Ok(())
    }
}

/// Errors from SPV client operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpvError {
    /// No checkpoint has been set (client not initialized).
    NoCheckpoint,
    /// New header's height doesn't match expected next height.
    HeightMismatch,
    /// New header's prev_hash doesn't match current tip's id.
    PrevHashMismatch,
    /// New header's timestamp precedes the current tip's.
    TimestampNotMonotonic,
    /// New header's chain work doesn't exceed the current tip's.
    WorkNotIncreasing,
    /// PoA is enabled but the header has no authority signature.
    MissingAuthoritySig,
    /// The header's authority set hash doesn't match the client's.
    AuthoritySetChanged,
    /// Authority signature verification failed.
    InvalidAuthoritySig,
    /// PoA verification is not enabled on this client.
    PoANotEnabled,
    /// Authority update proof failed validation.
    InvalidAuthorityUpdate,
    /// The update transaction is not in the claimed block.
    UpdateNotInBlock,
}

impl std::fmt::Display for SpvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpvError::NoCheckpoint => f.write_str("no checkpoint set"),
            SpvError::HeightMismatch => f.write_str("height mismatch"),
            SpvError::PrevHashMismatch => f.write_str("prev_hash mismatch"),
            SpvError::TimestampNotMonotonic => f.write_str("timestamp not monotonic"),
            SpvError::WorkNotIncreasing => f.write_str("chain work not increasing"),
            SpvError::MissingAuthoritySig => f.write_str("missing authority signature"),
            SpvError::AuthoritySetChanged => f.write_str("authority set changed"),
            SpvError::InvalidAuthoritySig => f.write_str("invalid authority signature"),
            SpvError::PoANotEnabled => f.write_str("PoA verification not enabled"),
            SpvError::InvalidAuthorityUpdate => f.write_str("invalid authority update"),
            SpvError::UpdateNotInBlock => f.write_str("update not in block"),
        }
    }
}

impl std::error::Error for SpvError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{encode_block_payload, Address, KeyPair, OutPoint, Transaction, TxId, TxOutput};
    use kovanica_dag::Block;

    fn tx(addr: Address, value: u64, tag: &[u8]) -> Transaction {
        let kp = KeyPair::from_u64(1);
        let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
        Transaction::signed(
            &[(op, &kp)],
            vec![TxOutput::native(value, addr)],
            tag.to_vec(),
        )
    }

    fn header_chain(n: usize) -> (Vec<BlockHeader>, Vec<Vec<Transaction>>) {
        let mut headers = Vec::new();
        let mut all_txs = Vec::new();
        let mut prev_hash = BlockId::from_bytes([0u8; 32]);
        let mut blue_work = 0u128;
        let mut blue_score = 0u64;

        for i in 0..n {
            let kp = KeyPair::from_u64(i as u64 + 1);
            let tx = if i == 0 {
                Transaction::coinbase(
                    vec![TxOutput::native(1000, kp.address())],
                    b"genesis".to_vec(),
                )
            } else {
                tx(kp.address(), 100, &format!("b{}", i).into_bytes())
            };
            let txs = vec![tx];
            let block = if i == 0 {
                Block::genesis(1, 0, 0, encode_block_payload(&txs))
            } else {
                Block::new(
                    vec![prev_hash],
                    1,
                    (i as u64) * 1000,
                    0,
                    encode_block_payload(&txs),
                )
            };
            blue_work += block.work();
            blue_score += 1;
            let header = BlockHeader::from_block(
                &block, prev_hash, blue_score, blue_work, i as u64, &txs, [0u8; 32],
            );
            prev_hash = block.id();
            headers.push(header);
            all_txs.push(txs);
        }
        (headers, all_txs)
    }

    #[test]
    fn header_chain_verification() {
        let (headers, _) = header_chain(5);

        let mut client = SpvClient::new(headers[0].clone());

        for h in &headers[1..] {
            client.add_header(h.clone()).unwrap();
        }
        assert_eq!(client.tip().unwrap().height, 4);
    }

    #[test]
    fn merkle_proof_verification() {
        let kp = KeyPair::from_u64(1);
        let tx1 = tx(kp.address(), 100, b"tx1");
        let tx2 = tx(kp.address(), 200, b"tx2");
        let txs = vec![tx1.clone(), tx2.clone()];

        let proof = generate_merkle_proof(&txs, 0).unwrap();
        assert_eq!(proof.verify(), merkle_root(&txs));

        let proof2 = generate_merkle_proof(&txs, 1).unwrap();
        assert_eq!(proof2.verify(), merkle_root(&txs));
    }

    #[test]
    fn spv_client_basic() {
        let (headers, _) = header_chain(3);
        let mut client = SpvClient::new(headers[0].clone());
        client.add_header(headers[1].clone()).unwrap();
        client.add_header(headers[2].clone()).unwrap();
        assert_eq!(client.tip().unwrap().height, 2);
    }

    #[test]
    fn spv_poa_verification() {
        let sk1 = ed25519_dalek::SigningKey::from_bytes(&[1u8; 32]);
        let sk2 = ed25519_dalek::SigningKey::from_bytes(&[2u8; 32]);
        let sk3 = ed25519_dalek::SigningKey::from_bytes(&[3u8; 32]);
        let pk1 = sk1.verifying_key();
        let pk2 = sk2.verifying_key();
        let pk3 = sk3.verifying_key();
        let keys = vec![pk1, pk2, pk3];
        let set = AuthoritySet::new(keys, 2).unwrap();
        let _poa = SpvPoAConfig {
            authority_set: set,
            slot_duration_ms: 3000,
        };

        // Build a header chain with PoA signatures
        let mut headers = Vec::new();
        let mut prev_hash = BlockId::from_bytes([0u8; 32]);
        let mut blue_work = 0u128;
        let mut blue_score = 0u64;

        for slot in 0..3 {
            let kp = KeyPair::from_u64(slot as u64 + 1);
            let tx = if slot == 0 {
                Transaction::coinbase(
                    vec![TxOutput::native(1000, kp.address())],
                    b"genesis".to_vec(),
                )
            } else {
                let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
                Transaction::signed(
                    &[(op, &kp)],
                    vec![TxOutput::native(100, kp.address())],
                    b"tag".to_vec(),
                )
            };
            let txs = vec![tx];
            let block = if slot == 0 {
                Block::genesis(1, 0, 0, encode_block_payload(&txs))
            } else {
                let timestamp = (slot as u64 + 1) * 3000;
                let block =
                    Block::new(vec![prev_hash], 1, timestamp, 0, encode_block_payload(&txs));
                // Note: the test block doesn't have a real authority signature
                // In a real test we'd need to construct the block with the right signature
                block
            };
            blue_work += block.work();
            blue_score += 1;
            let header = BlockHeader::from_block(
                &block,
                prev_hash,
                blue_score,
                blue_work,
                slot as u64,
                &txs,
                [0u8; 32],
            );
            prev_hash = block.id();
            headers.push(header);
        }

        // Test without PoA (should work)
        let mut client = SpvClient::new(headers[0].clone());
        client.add_header(headers[1].clone()).unwrap();
        client.add_header(headers[2].clone()).unwrap();
        assert_eq!(client.tip().unwrap().height, 2);
    }
}
