//! RFC-009 **R8** — a snapshot must preserve the block-pruning policy.
//!
//! The snapshot header stores `finality_depth`, `payload_pruning_depth` and
//! (since ledger version 3) `block_pruning_depth`. A reloaded snapshot must
//! therefore expose the same block-pruning depth as the ledger it came from,
//! so a node that was running with a finite depth does not silently come back
//! with pruning disabled, and a node that had it disabled does not come back
//! with it enabled.
//!
//! The replay-based snapshot format cannot represent a DAG that has actually
//! evicted blocks (a present block whose parent was evicted would fail to
//! re-admit, and evicted blocks' payloads are gone so their deltas cannot be
//! rebuilt). `write_snapshot` therefore refuses with
//! `LedgerSnapshotError::BlockPruningUnsupported` once eviction has happened; a
//! pruning node must use the checkpoint or log tier instead.

use kovanica_state::{
    HalvingSchedule, KeyPair, Ledger, LedgerSnapshotError, Transaction, TxOutput,
    DEFAULT_HALVING_ERA,
};

const K: u16 = 3;
const SCHEDULE: HalvingSchedule = HalvingSchedule::new(1_000, DEFAULT_HALVING_ERA);

fn coinbase_tx() -> Transaction {
    Transaction::coinbase(
        vec![TxOutput::native(500, KeyPair::from_u64(1).address())],
        b"genesis".to_vec(),
    )
}

fn build_chain(ledger: &mut Ledger, len: usize) {
    let mut tip = ledger.genesis();
    for _ in 0..len {
        tip = ledger.insert(vec![tip], 1, 0, 0, &[]).unwrap();
    }
}

/// A finite depth well beyond the built chain — no block is evicted, so the
/// test isolates the header round-trip from the eviction path.
#[test]
fn snapshot_round_trip_preserves_a_finite_block_pruning_depth() {
    let mut ledger =
        Ledger::with_finality_and_block_pruning(K, SCHEDULE, &[coinbase_tx()], 4, 100).unwrap();
    build_chain(&mut ledger, 20);
    assert_eq!(ledger.block_pruning_depth(), 100);

    let bytes = ledger.write_snapshot().unwrap();
    let restored = Ledger::read_snapshot(&bytes).unwrap();
    assert_eq!(
        restored.block_pruning_depth(),
        100,
        "a finite block-pruning depth must survive a snapshot"
    );
    // The header (and the whole snapshot) re-serializes identically.
    assert_eq!(restored.write_snapshot().unwrap(), bytes);
}

/// A depth that actually evicts blocks: the replay-based snapshot cannot
/// represent a pruned DAG, so writing one is refused rather than producing a
/// snapshot that cannot be reloaded (RFC-009 R8).
#[test]
fn snapshot_write_is_refused_after_block_pruning_evicts() {
    let mut ledger =
        Ledger::with_finality_and_block_pruning(K, SCHEDULE, &[coinbase_tx()], 4, 4).unwrap();
    build_chain(&mut ledger, 30);
    assert_eq!(ledger.block_pruning_depth(), 4);
    assert!(
        ledger.dag().pruning_point() != ledger.genesis(),
        "the chain must have advanced far enough to evict a block"
    );

    assert!(matches!(
        ledger.write_snapshot(),
        Err(LedgerSnapshotError::BlockPruningUnsupported)
    ));
}

/// Disabled stays disabled.
#[test]
fn snapshot_round_trip_preserves_disabled_block_pruning() {
    let mut ledger =
        Ledger::with_finality_and_block_pruning(K, SCHEDULE, &[coinbase_tx()], 4, u64::MAX)
            .unwrap();
    build_chain(&mut ledger, 10);
    assert_eq!(ledger.block_pruning_depth(), u64::MAX);

    let bytes = ledger.write_snapshot().unwrap();
    let restored = Ledger::read_snapshot(&bytes).unwrap();
    assert_eq!(
        restored.block_pruning_depth(),
        u64::MAX,
        "a disabled block-pruning policy must stay disabled"
    );
}
