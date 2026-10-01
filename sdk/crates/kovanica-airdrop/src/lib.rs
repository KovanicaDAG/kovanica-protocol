//! Kovanica airdrop — Merkle tree and claim types.
//!
//! Airdrops are distributed to stakers and miners. Eligibility is proven
//! via a Merkle proof: the claimant provides a Merkle path from their
//! leaf to the root, and the contract verifies it.

use kovanica_types::{Address, AssetId, Hash32};
use serde::{Deserialize, Serialize};

/// A single airdrop campaign.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirdropCampaign {
    /// Campaign identifier (unique per airdrop).
    pub id: Hash32,
    /// Total amount allocated to this campaign.
    pub total_amount: u64,
    /// Asset being airdropped (usually NATIVE).
    pub asset_id: AssetId,
    /// Block height at which the campaign expires.
    pub expires_at: u64,
    /// Merkle root of the eligibility tree.
    pub merkle_root: Hash32,
}

/// A leaf in the airdrop Merkle tree.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AirdropLeaf {
    /// Claimant address.
    pub address: Address,
    /// Amount allocated to this claimant.
    pub amount: u64,
}

/// A Merkle proof for an airdrop claim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleProof {
    /// The leaf being proven.
    pub leaf: AirdropLeaf,
    /// Sibling hashes from leaf to root.
    pub siblings: Vec<Hash32>,
    /// For each level, whether the current node was the left child (true) or right child (false).
    pub is_left: Vec<bool>,
}

impl MerkleProof {
    /// Verify this proof against a known Merkle root.
    pub fn verify(&self, root: Hash32) -> bool {
        let mut current = hash_leaf(&self.leaf);
        for (i, sibling) in self.siblings.iter().enumerate() {
            if self.is_left[i] {
                current = hash_pair(current, *sibling);
            } else {
                current = hash_pair(*sibling, current);
            }
        }
        current == root
    }
}

/// Hash a leaf node.
fn hash_leaf(leaf: &AirdropLeaf) -> Hash32 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(leaf.address.as_bytes());
    hasher.update(&leaf.amount.to_le_bytes());
    Hash32(hasher.finalize().into())
}

/// Hash two sibling nodes.
fn hash_pair(left: Hash32, right: Hash32) -> Hash32 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&left.0);
    hasher.update(&right.0);
    Hash32(hasher.finalize().into())
}

/// Build a Merkle tree from leaves and return the root.
pub fn build_merkle_root(leaves: &[AirdropLeaf]) -> Hash32 {
    if leaves.is_empty() {
        return Hash32::ZERO;
    }
    let mut level: Vec<Hash32> = leaves.iter().map(hash_leaf).collect();
    while level.len() > 1 {
        let mut next = Vec::new();
        for chunk in level.chunks(2) {
            if chunk.len() == 2 {
                next.push(hash_pair(chunk[0], chunk[1]));
            } else {
                next.push(chunk[0]);
            }
        }
        level = next;
    }
    level[0]
}

/// Generate a Merkle proof for a specific leaf.
pub fn generate_proof(leaves: &[AirdropLeaf], index: usize) -> Option<MerkleProof> {
    if index >= leaves.len() {
        return None;
    }
    let leaf = leaves[index];
    let mut siblings = Vec::new();
    let mut is_left = Vec::new();
    let mut level: Vec<Hash32> = leaves.iter().map(hash_leaf).collect();
    let mut idx = index;

    while level.len() > 1 {
        let sibling_idx = if idx.is_multiple_of(2) { idx + 1 } else { idx - 1 };
        if sibling_idx < level.len() {
            siblings.push(level[sibling_idx]);
            is_left.push(idx.is_multiple_of(2)); // current node is left if its index is even
        }
        let mut next = Vec::new();
        for chunk in level.chunks(2) {
            if chunk.len() == 2 {
                next.push(hash_pair(chunk[0], chunk[1]));
            } else {
                next.push(chunk[0]);
            }
        }
        level = next;
        idx /= 2;
    }

    Some(MerkleProof { leaf, siblings, is_left })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_leaf(addr_byte: u8, amount: u64) -> AirdropLeaf {
        AirdropLeaf {
            address: Address::from_versioned([addr_byte; 33]),
            amount,
        }
    }

    #[test]
    fn merkle_root_is_deterministic() {
        let leaves = vec![demo_leaf(1, 100), demo_leaf(2, 200), demo_leaf(3, 300)];
        let root1 = build_merkle_root(&leaves);
        let root2 = build_merkle_root(&leaves);
        assert_eq!(root1, root2);
    }

    #[test]
    fn merkle_proof_verifies() {
        let leaves = vec![demo_leaf(1, 100), demo_leaf(2, 200), demo_leaf(3, 300)];
        let root = build_merkle_root(&leaves);
        let proof = generate_proof(&leaves, 1).unwrap();
        assert!(proof.verify(root));
    }

    #[test]
    fn merkle_proof_rejects_wrong_root() {
        let leaves = vec![demo_leaf(1, 100), demo_leaf(2, 200), demo_leaf(3, 300)];
        let proof = generate_proof(&leaves, 0).unwrap();
        assert!(!proof.verify(Hash32::ZERO));
    }

    #[test]
    fn empty_tree_returns_zero() {
        assert_eq!(build_merkle_root(&[]), Hash32::ZERO);
    }
}
