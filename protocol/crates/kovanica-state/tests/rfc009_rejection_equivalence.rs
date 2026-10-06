//! RFC-009 **R7** — rejection equivalence between a block-pruning node and a
//! non-pruning node.
//!
//! Block pruning must not change which blocks a node accepts. The consensus
//! rule is "a block may not build on history behind the finality point" — no
//! parent and no mergeset candidate below or in the anticone of that point —
//! and both node roles must evaluate it identically. This test drives two
//! ledgers with the same finality depth (one with block pruning enabled, one
//! disabled) through the same random parent sets — sometimes recent, sometimes
//! reaching back into already-final history — and requires identical
//! accept/reject decisions and identical accepted block ids.
//!
//! Before the ledger-side check was added, every seed diverged: a pruning node
//! rejected a block whose parent had been evicted (`MissingParent` /
//! `BuildsOnPrunedHistory`) while the non-pruning node accepted it.

use std::collections::BTreeSet;

use kovanica_state::{
    HalvingSchedule, KeyPair, Ledger, Transaction, TxOutput, DEFAULT_HALVING_ERA,
};

const K: u16 = 3;
const SUBSIDY: u64 = 1_000;
const SCHEDULE: HalvingSchedule = HalvingSchedule::new(SUBSIDY, DEFAULT_HALVING_ERA);

fn coinbase_tx() -> Transaction {
    Transaction::coinbase(
        vec![TxOutput::native(500, KeyPair::from_u64(1).address())],
        b"genesis".to_vec(),
    )
}

fn ledger(finality: u64, block_pruning: u64) -> Ledger {
    Ledger::with_finality_and_block_pruning(K, SCHEDULE, &[coinbase_tx()], finality, block_pruning)
        .unwrap()
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            (self.next() >> 33) % n
        }
    }
}

/// Drive a pruning and a non-pruning ledger through the same random parent
/// sets; return the number of accept/reject divergences over `seeds`.
fn count_divergences(finality: u64, block_pruning: u64, seeds: u64) -> u64 {
    let mut divergences = 0u64;
    for seed in 0..seeds {
        let mut rng = Rng(seed.wrapping_add(1));
        let mut a = ledger(finality, block_pruning);
        let mut b = ledger(finality, u64::MAX);
        let mut ids = vec![a.genesis()];
        for step in 0..40 {
            let n = ids.len();
            let want = 1 + rng.below(2) as usize;
            // Sometimes a recent window, sometimes the whole history, so forks
            // off already-final blocks are exercised.
            let window = (2 + rng.below(n as u64) as usize).min(n);
            let lo = n - window;
            let mut idxs = BTreeSet::new();
            for _ in 0..want {
                idxs.insert(lo + rng.below(window as u64) as usize);
            }
            let parents: Vec<_> = idxs.iter().map(|&i| ids[i]).collect();
            let ra = a.insert(parents.clone(), 1, 0, 0, &[]);
            let rb = b.insert(parents, 1, 0, 0, &[]);
            match (ra, rb) {
                (Ok(ia), Ok(ib)) => {
                    assert_eq!(
                        ia, ib,
                        "finality={finality} block_pruning={block_pruning} seed={seed} \
                         step={step}: accepted ids differ"
                    );
                    ids.push(ia);
                }
                (Err(_), Err(_)) => {}
                (x, y) => {
                    divergences += 1;
                    if divergences <= 20 {
                        eprintln!(
                            "DIVERGENCE finality={finality} block_pruning={block_pruning} \
                             seed={seed} step={step} n={n} parents={idxs:?}\n  prune={x:?}\n  \
                             no-prune={y:?}"
                        );
                    }
                    break;
                }
            }
        }
    }
    divergences
}

/// The canonical configuration: the eviction depth equals the finality depth,
/// so the pruning point coincides with the finality point.
#[test]
fn pruning_and_non_pruning_nodes_accept_the_same_blocks() {
    assert_eq!(count_divergences(4, 4, 1000), 0);
}

/// A pruning node may be configured to evict more than the finality window. The
/// ledger-side finality check is evaluated against the finality point on both
/// node roles, so the two still accept the same blocks.
#[test]
fn eviction_deeper_than_finality_still_accepts_the_same_blocks() {
    assert_eq!(count_divergences(4, 8, 1000), 0);
}
