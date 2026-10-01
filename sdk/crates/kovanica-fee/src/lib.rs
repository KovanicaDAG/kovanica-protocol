//! Fee estimation aligned with RFC-006 tokenomics.
//!
//! Fee floor: `max(1, subsidy / 500_000)` atoms per byte.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use kovanica_types::Amount;

/// Divisor used in the protocol fee floor formula.
pub const FEE_FLOOR_DIVISOR: u64 = 500_000;

/// Estimate fee for a transaction of the given serialized size.
///
/// `subsidy` is the current block subsidy in atoms (from `/api/head` or chain state).
/// Returns at least 1 atom per byte when subsidy is large enough, otherwise 1 atom total minimum.
pub fn estimate(size_bytes: u64, subsidy_atoms: u64) -> Amount {
    let per_byte = std::cmp::max(1, subsidy_atoms / FEE_FLOOR_DIVISOR);
    let fee = size_bytes.saturating_mul(per_byte);
    Amount::from_atoms(std::cmp::max(1, fee))
}

/// Estimate fee for a transaction of the given serialized size, never below a
/// node-advertised minimum total fee.
///
/// `subsidy` is the current block subsidy in atoms (from `/api/head` or chain
/// state); `min_fee_atoms` is the minimum the node will accept (its own floor).
/// Returns at least 1 atom per byte when subsidy is large enough, and at least
/// `min_fee_atoms` total.
pub fn estimate_with_min(size_bytes: u64, subsidy_atoms: u64, min_fee_atoms: u64) -> Amount {
    let from_size = estimate(size_bytes, subsidy_atoms);
    Amount::from_atoms(std::cmp::max(min_fee_atoms, from_size.atoms()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floor_with_large_subsidy() {
        // 10 KVNC subsidy = 1_000_000_000 atoms → floor = 2000 atoms/byte
        let subsidy = 1_000_000_000u64;
        let fee = estimate(250, subsidy);
        assert_eq!(fee.atoms(), 250 * 2000);
    }

    #[test]
    fn never_zero() {
        let fee = estimate(1, 0);
        assert!(fee.atoms() >= 1);
    }

    #[test]
    fn with_min_respects_floor() {
        // Large subsidy: per-byte floor dominates.
        let subsidy = 1_000_000_000u64; // 10 KVNC → 2000 atoms/byte
        let fee = estimate_with_min(100, subsidy, 50_000);
        // 100 * 2000 = 200_000 > min 50_000.
        assert_eq!(fee.atoms(), 200_000);
    }

    #[test]
    fn with_min_never_below_min() {
        // Tiny subsidy → per-byte floor ~1 atom/byte, min fee must win.
        let fee = estimate_with_min(100, 0, 50_000);
        assert_eq!(fee.atoms(), 50_000);
        // Even a generous subsidy must not dip under an explicit min.
        let fee2 = estimate_with_min(10, 1_000_000_000, 500_000);
        // 10 * 2000 = 20_000 < min → min wins.
        assert_eq!(fee2.atoms(), 500_000);
    }
}
