//! The UTXO set: the ledger's state.
//!
//! A [`UtxoSet`] maps every currently-unspent [`OutPoint`] to the [`TxOutput`]
//! it holds. Applying a transaction removes the outputs it spends and inserts
//! the ones it creates (see [`crate::ledger`]). Lookups are by key only, so the
//! backing `HashMap`'s iteration order never affects a consensus-relevant
//! result.

use std::collections::HashMap;

use crate::keys::Address;
use crate::tx::{AssetId, OutPoint, TxId, TxOutput};

/// The set of unspent transaction outputs — the full ledger state at a point in
/// the linearized order.
///
/// Alongside the outputs themselves, the set tracks the **block height at which
/// each output was created** (BIP-112 relative locktime support). The creation
/// height is the creating block's own selected-chain height (its blue score) —
/// a pure function of the DAG, fixed at insert, identical in every node's view.
/// It lives in a parallel map (NOT a `TxOutput` field) because `TxOutput` is in
/// the canonical tx encoding and the sighash domain: creation height is
/// unknowable at signing time, so it cannot be signed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UtxoSet {
    map: HashMap<OutPoint, TxOutput>,
    /// Block height at which each output was created (BIP-112 relative
    /// locktime support). Every output in `map` has an entry here; the map is
    /// empty only for UTXO sets decoded from pre-v6 checkpoints.
    created_at: HashMap<OutPoint, u64>,
}

impl UtxoSet {
    /// An empty UTXO set.
    pub fn new() -> Self {
        Self::default()
    }

    /// Look up the output at `outpoint`, if unspent.
    pub fn get(&self, outpoint: &OutPoint) -> Option<&TxOutput> {
        self.map.get(outpoint)
    }

    /// Whether `outpoint` is currently unspent.
    pub fn contains(&self, outpoint: &OutPoint) -> bool {
        self.map.contains_key(outpoint)
    }

    /// The block height at which `outpoint` was created, if known.
    ///
    /// `None` only for outputs decoded from pre-v6 checkpoints — their age is
    /// unknowable, so relative-locktime spends of them fail closed
    /// ([`crate::ledger::LedgerError::UnknownOutputAge`]).
    pub fn created_at_of(&self, outpoint: &OutPoint) -> Option<u64> {
        self.created_at.get(outpoint).copied()
    }

    /// Insert an output, returning any output previously stored at that outpoint.
    ///
    /// `created_at` is the block height at which the output was created (the
    /// creating block's own selected-chain height). Every output inserted this
    /// way gets a creation height; the map is empty only for UTXO sets decoded
    /// from pre-v6 checkpoints.
    pub fn insert(
        &mut self,
        outpoint: OutPoint,
        output: TxOutput,
        created_at: u64,
    ) -> Option<TxOutput> {
        self.created_at.insert(outpoint, created_at);
        self.map.insert(outpoint, output)
    }

    /// Remove and return the output at `outpoint`, if present.
    pub fn remove(&mut self, outpoint: &OutPoint) -> Option<TxOutput> {
        self.created_at.remove(outpoint);
        self.map.remove(outpoint)
    }

    /// Number of unspent outputs.
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// Whether the set is empty.
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// Iterate over every unspent `(outpoint, output)`. Order is unspecified.
    pub fn iter(&self) -> impl Iterator<Item = (&OutPoint, &TxOutput)> {
        self.map.iter()
    }

    /// Total value of every unspent output. Widened to `u128` so summing many
    /// `u64` outputs cannot overflow.
    pub fn total_value(&self) -> u128 {
        self.map.values().map(|o| u128::from(o.value)).sum()
    }

    /// Spendable balance owned by `owner`: the sum of the unspent **native KVNC**
    /// outputs locked to that address. Asset outputs (RFC-002) are excluded —
    /// query them with [`Self::balance_of_asset`].
    pub fn balance(&self, owner: &Address) -> u128 {
        self.map
            .values()
            .filter(|o| &o.owner == owner && o.asset_id.is_none())
            .map(|o| u128::from(o.value))
            .sum()
    }

    /// Spendable balance owned by `owner` for a specific `asset_id`.
    /// `asset_id = None` means native KVNC.
    pub fn balance_of_asset(&self, owner: &Address, asset_id: Option<AssetId>) -> u128 {
        self.map
            .values()
            .filter(|o| &o.owner == owner && o.asset_id == asset_id)
            .map(|o| u128::from(o.value))
            .sum()
    }

    /// Serialise the UTXO set for checkpoint persistence. Returns a
    /// self-contained byte encoding: count followed by (outpoint, output) pairs,
    /// sorted by outpoint for deterministic encoding.
    /// v4: includes optional asset_id (32 bytes) after owner.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(self.map.len() as u64).to_le_bytes());
        let mut entries: Vec<_> = self.map.iter().collect();
        entries.sort_by_key(|(op, _)| *op);
        for (op, output) in entries {
            buf.extend_from_slice(op.tx.as_bytes());
            buf.extend_from_slice(&op.index.to_le_bytes());
            buf.extend_from_slice(&output.value.to_le_bytes());
            buf.extend_from_slice(output.owner.as_bytes());
            // asset_id: 0 = native (None), 1 = present + 32 bytes
            if let Some(asset_id) = output.asset_id {
                buf.push(1);
                buf.extend_from_slice(asset_id.as_bytes());
            } else {
                buf.push(0);
            }
            // stealth flag: 0 = ordinary, 1 = stealth + 65-byte extension
            // (R 32B + view_tag 1B + P 32B), mirroring the canonical TxOutput
            // encoding in tx.rs.
            if let Some(stealth) = output.stealth {
                buf.push(1);
                buf.extend_from_slice(&stealth.r);
                buf.push(stealth.view_tag);
                buf.extend_from_slice(&stealth.p);
            } else {
                buf.push(0);
            }
            // v6: creation height (8 bytes LE) — the block height at which the
            // output was created (BIP-112 relative locktime support). Unknown
            // ages (pre-v6 checkpoints) encode as u64::MAX so a re-encode
            // round-trip stays fail-closed on CSV spends.
            let created_at = self.created_at.get(op).copied().unwrap_or(u64::MAX);
            buf.extend_from_slice(&created_at.to_le_bytes());
        }
        buf
    }

    /// Returns the length of the encoded UTXO set (for skipping during decode).
    pub fn encoded_len(&self) -> usize {
        8 + self
            .map
            .values()
            .map(|output| {
                let asset = if output.asset_id.is_some() { 1 + 32 } else { 1 };
                let stealth = if output.stealth.is_some() { 1 + 65 } else { 1 };
                // +8 for the v6 creation height.
                32 + 4 + 8 + 33 + asset + stealth + 8
            })
            .sum::<usize>()
    }

    /// Decode a UTXO set from a checkpoint encoding, advancing `bytes` past the
    /// consumed data so the caller can continue parsing.
    /// v4: reads optional asset_id (32 bytes) after owner.
    /// v5: reads optional stealth extension (65 bytes) after the asset_id.
    /// v6: reads the per-output creation height (8 bytes) after the stealth flag.
    ///
    /// Pre-v6 encodings decode with an **empty** `created_at` map — their
    /// outputs' ages are unknown, so relative-locktime spends of them fail
    /// closed ([`crate::ledger::LedgerError::UnknownOutputAge`]). Never default
    /// unknown ages to 0: that would silently disable the relative lock.
    pub fn decode(bytes: &mut &[u8], version: u16) -> Result<Self, UtxoDecodeError> {
        let mut reader = CheckpointReader::new(bytes);
        let count = reader.read_u64()? as usize;
        let mut map = HashMap::with_capacity(count);
        let mut created_at = HashMap::with_capacity(count);
        for _ in 0..count {
            let tx = TxId::from_bytes(reader.read_array::<32>()?);
            let index = reader.read_u32()?;
            let value = reader.read_u64()?;
            let owner = Address::from_versioned_bytes(reader.read_array::<33>()?);
            // asset_id flag
            let asset_flag = reader.read_u8()?;
            let asset_id = if asset_flag == 1 {
                Some(AssetId::from_bytes(reader.read_array::<32>()?))
            } else {
                None
            };
            // stealth flag: 0 = ordinary, 1 = stealth + 65-byte extension
            let stealth_flag = reader.read_u8()?;
            let stealth = if stealth_flag == 1 {
                let r = reader.read_array::<32>()?;
                let view_tag = reader.read_u8()?;
                let p = reader.read_array::<32>()?;
                Some(crate::tx::StealthExt { r, view_tag, p })
            } else {
                None
            };
            let op = OutPoint::new(tx, index);
            if version >= 6 {
                let created = reader.read_u64()?;
                created_at.insert(op, created);
            }
            map.insert(
                op,
                TxOutput {
                    value,
                    asset_id,
                    owner,
                    stealth,
                },
            );
        }
        *bytes = &bytes[reader.pos..];
        Ok(Self { map, created_at })
    }
}

/// Errors from decoding a UTXO set checkpoint.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UtxoDecodeError {
    /// The input ended before a fully-formed value could be read.
    UnexpectedEof,
    /// Bytes remained after the declared number of entries.
    TrailingBytes,
}

impl core::fmt::Display for UtxoDecodeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            UtxoDecodeError::UnexpectedEof => f.write_str("unexpected end of checkpoint"),
            UtxoDecodeError::TrailingBytes => f.write_str("trailing bytes after checkpoint"),
        }
    }
}

impl std::error::Error for UtxoDecodeError {}

struct CheckpointReader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> CheckpointReader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }
    fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }
    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], UtxoDecodeError> {
        if self.remaining() < N {
            return Err(UtxoDecodeError::UnexpectedEof);
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.buf[self.pos..self.pos + N]);
        self.pos += N;
        Ok(out)
    }
    fn read_u32(&mut self) -> Result<u32, UtxoDecodeError> {
        Ok(u32::from_le_bytes(self.read_array::<4>()?))
    }
    fn read_u64(&mut self) -> Result<u64, UtxoDecodeError> {
        Ok(u64::from_le_bytes(self.read_array::<8>()?))
    }
    fn read_u8(&mut self) -> Result<u8, UtxoDecodeError> {
        if self.remaining() < 1 {
            return Err(UtxoDecodeError::UnexpectedEof);
        }
        let b = self.buf[self.pos];
        self.pos += 1;
        Ok(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KeyPair;
    use crate::tx::TxId;

    #[test]
    fn utxo_set_roundtrips() {
        let owner = KeyPair::from_u64(1).address();
        let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
        let mut set = UtxoSet::new();
        set.insert(op, TxOutput::native(10, owner), 5);
        set.insert(
            OutPoint::new(TxId::from_bytes([2u8; 32]), 1),
            TxOutput::native(20, owner),
            7,
        );

        let bytes = set.encode();
        let mut slice = &bytes[..];
        let restored = UtxoSet::decode(&mut slice, 6).unwrap();

        assert_eq!(restored.len(), 2);
        assert_eq!(restored.get(&op), Some(&TxOutput::native(10, owner)));
        assert_eq!(restored.total_value(), 30);
        // v6 roundtrip preserves creation heights.
        assert_eq!(restored.created_at_of(&op), Some(5));
        assert_eq!(
            restored.created_at_of(&OutPoint::new(TxId::from_bytes([2u8; 32]), 1)),
            Some(7)
        );
    }

    #[test]
    fn empty_utxo_set_roundtrips() {
        let set = UtxoSet::new();
        let bytes = set.encode();
        let mut slice = &bytes[..];
        let restored = UtxoSet::decode(&mut slice, 6).unwrap();
        assert!(restored.is_empty());
    }

    #[test]
    fn insert_get_remove() {
        let owner = KeyPair::from_u64(1).address();
        let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
        let mut set = UtxoSet::new();
        assert!(set.is_empty());
        set.insert(op, TxOutput::native(10, owner), 3);
        assert_eq!(set.get(&op), Some(&TxOutput::native(10, owner)));
        assert_eq!(set.balance(&owner), 10);
        assert_eq!(set.total_value(), 10);
        assert_eq!(set.created_at_of(&op), Some(3));
        assert_eq!(set.remove(&op), Some(TxOutput::native(10, owner)));
        assert!(set.is_empty());
        // remove also drops the creation height.
        assert_eq!(set.created_at_of(&op), None);
    }

    #[test]
    fn created_at_roundtrip() {
        let owner = KeyPair::from_u64(1).address();
        let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
        let mut set = UtxoSet::new();
        assert_eq!(set.created_at_of(&op), None);
        set.insert(op, TxOutput::native(10, owner), 42);
        assert_eq!(set.created_at_of(&op), Some(42));
        // Re-inserting replaces the height.
        set.insert(op, TxOutput::native(11, owner), 43);
        assert_eq!(set.created_at_of(&op), Some(43));
        assert_eq!(set.get(&op), Some(&TxOutput::native(11, owner)));
    }

    #[test]
    fn encode_decode_v6_preserves_heights() {
        let owner = KeyPair::from_u64(1).address();
        let op1 = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
        let op2 = OutPoint::new(TxId::from_bytes([2u8; 32]), 1);
        let mut set = UtxoSet::new();
        set.insert(op1, TxOutput::native(10, owner), 0);
        set.insert(op2, TxOutput::native(20, owner), 100);

        let bytes = set.encode();
        assert_eq!(bytes.len(), set.encoded_len());
        let mut slice = &bytes[..];
        let restored = UtxoSet::decode(&mut slice, 6).unwrap();
        assert!(slice.is_empty(), "decode must consume the whole encoding");
        assert_eq!(restored, set);
        assert_eq!(restored.created_at_of(&op1), Some(0));
        assert_eq!(restored.created_at_of(&op2), Some(100));
    }

    #[test]
    fn decode_v5_leaves_created_at_empty() {
        let owner = KeyPair::from_u64(1).address();
        let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
        let mut set = UtxoSet::new();
        set.insert(op, TxOutput::native(10, owner), 42);

        let bytes = set.encode();
        // A v5 reader stops before the trailing 8-byte creation heights.
        let mut slice = &bytes[..];
        let v5 = UtxoSet::decode(&mut slice, 5).unwrap();
        assert_eq!(v5.get(&op), Some(&TxOutput::native(10, owner)));
        assert_eq!(v5.created_at_of(&op), None, "pre-v6 ages are unknown");
        // The v5 reader leaves the 8 trailing bytes per output unconsumed.
        assert_eq!(slice.len(), 8);
    }
}
