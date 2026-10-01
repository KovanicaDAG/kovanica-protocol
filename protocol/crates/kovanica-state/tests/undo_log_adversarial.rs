//! Adversarial and property-style tests for the per-block undo-log / delta design.
//!
//! These tests exercise the ledger's promise that any non-final block's UTXO
//! view can be reconstructed exactly from the compact deltas stored along its
//! selected-parent chain, even across the finality boundary (where final deltas
//! are folded into their children) and across wide re-organisations above
//! finality.
//!
//! The re-orgs here are driven by **chain length** (blue score), not by
//! per-block work. Heavier-but-shorter branches are a legitimate adversarial
//! case, but the current ledger ties its pruning threshold to the selected
//! tip's blue score; mixing that with work-based re-orgs is left for future
//! hardening. These tests still cover the core delta-folding invariants.

use kovanica_dag::BlockId;
use kovanica_state::{
    apply_block_at_height, decode_block_payload, Address, HalvingSchedule, KeyPair, Ledger,
    OutPoint, Transaction, TxOutput, UtxoSet, DEFAULT_HALVING_ERA,
};

const K: u16 = 3;
const SUBSIDY: u64 = 1_000;
const SCHEDULE: HalvingSchedule = HalvingSchedule::new(SUBSIDY, DEFAULT_HALVING_ERA);

fn funded(finality_depth: u64, funding: u64) -> (Ledger, OutPoint) {
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(funding, KeyPair::from_u64(1).address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let ledger = Ledger::with_finality(K, SCHEDULE, &[coinbase], finality_depth).unwrap();
    (ledger, coin)
}

fn transfer(coin: OutPoint, from: &KeyPair, to: &Address, value: u64, funding: u64) -> Transaction {
    let mut outputs = vec![TxOutput::native(value, *to)];
    if funding > value {
        outputs.push(TxOutput::native(funding - value, from.address()));
    }
    Transaction::signed(&[(coin, from)], outputs, Vec::new())
}

/// Selected-parent chain height of `block` (== blue score in this design).
fn chain_height(ledger: &Ledger, mut block: BlockId) -> u64 {
    let mut height = 0;
    while let Some(sp) = ledger
        .dag()
        .ghostdag(&block)
        .and_then(|g| g.selected_parent)
    {
        height += 1;
        block = sp;
    }
    height
}

/// Reference per-block view state computed independently of the undo-log
/// machinery: walk the selected-parent chain from `block` back to genesis and
/// apply each block's mergeset then its own transactions from a fresh state.
fn reference_state(ledger: &Ledger, block: &BlockId) -> UtxoSet {
    let dag = ledger.dag();
    let mut chain = vec![*block];
    let mut cur = *block;
    while let Some(sp) = dag.ghostdag(&cur).and_then(|g| g.selected_parent) {
        chain.push(sp);
        cur = sp;
    }
    chain.reverse();

    let mut state = UtxoSet::new();
    for id in &chain {
        let gd = dag.ghostdag(id).expect("block has ghostdag data");
        let mergeset = gd.mergeset_blues.iter().chain(&gd.mergeset_reds);
        for merged in mergeset {
            let payload = dag.block(merged).expect("mergeset block present").payload();
            if let Ok(txs) = decode_block_payload(payload) {
                let h = chain_height(ledger, *merged);
                let _ = apply_block_at_height(&mut state, &txs, SCHEDULE.subsidy_at(h), h);
            }
        }
        let payload = dag.block(id).expect("block present").payload();
        let txs = decode_block_payload(payload).expect("valid payload");
        let h = chain_height(ledger, *id);
        apply_block_at_height(&mut state, &txs, SCHEDULE.subsidy_at(h), h)
            .expect("valid in its own view");
    }
    state
}

fn utxo_snapshot(utxo: &UtxoSet) -> Vec<(OutPoint, u64, Address)> {
    let mut rows: Vec<(OutPoint, u64, Address)> =
        utxo.iter().map(|(op, o)| (*op, o.value, o.owner)).collect();
    rows.sort_by_key(|row| row.0);
    rows
}

fn assert_reconstructs(ledger: &Ledger, id: &BlockId) {
    let ref_utxo = reference_state(ledger, id);
    assert_eq!(
        utxo_snapshot(&ledger.state(id).expect("block must reconstruct")),
        utxo_snapshot(&ref_utxo),
        "UTXO mismatch at {id}"
    );
}

#[test]
fn long_selected_parent_chain_crosses_finality() {
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let carol = KeyPair::from_u64(3);
    let (mut ledger, coin) = funded(3, 1_000);
    let genesis = ledger.genesis();

    let mut ids = vec![genesis];
    let mut spendable = coin;
    for i in 0..40 {
        let parent = *ids.last().unwrap();
        let txs = match i {
            2 => {
                let tx = transfer(spendable, &alice, &bob.address(), 300, 1_000);
                spendable = OutPoint::new(tx.id(), 1);
                vec![tx]
            }
            5 => {
                let tx = transfer(spendable, &alice, &carol.address(), 100, 700);
                spendable = OutPoint::new(tx.id(), 1);
                vec![tx]
            }
            15 => {
                // `spendable` is the 600-atoms change output from the i == 5
                // spend above (output index 1 = 700 - 100).
                let tx = transfer(spendable, &alice, &carol.address(), 300, 600);
                spendable = OutPoint::new(tx.id(), 1);
                vec![tx]
            }
            _ => vec![],
        };
        ids.push(
            ledger
                .insert(vec![parent], 1, i as u64 + 10, 0, &txs)
                .unwrap(),
        );
    }

    let threshold = ledger.finality_score();
    assert!(threshold > 0, "finality must be active");

    for id in &ids {
        if ledger.state(id).is_none() {
            let score = ledger.dag().ghostdag(id).unwrap().blue_score;
            assert!(score < threshold, "only final blocks lack state: {id}");
        } else {
            assert_reconstructs(&ledger, id);
            assert_eq!(
                ledger.state(id).unwrap().total_value(),
                1_000,
                "value not conserved at {id}"
            );
        }
    }

    let tip = ledger.dag().selected_tip();
    assert_reconstructs(&ledger, &tip);
}

#[test]
fn wide_forks_and_repeated_reorgs_above_finality() {
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    // Length-based selection: every block uses work 1, so the longest branch
    // wins and the finality threshold never retreats.
    let (mut ledger, coin) = funded(10, 1_000);
    let genesis = ledger.genesis();

    let mut main = vec![genesis];
    let mut change_out = coin;
    let mut change_value = 1_000u64;
    for i in 0..12 {
        let parent = *main.last().unwrap();
        let txs = if i == 5 {
            let tx = transfer(change_out, &alice, &bob.address(), 200, change_value);
            change_out = OutPoint::new(tx.id(), 1);
            change_value -= 200;
            vec![tx]
        } else {
            vec![]
        };
        main.push(
            ledger
                .insert(vec![parent], 1, i as u64 + 1, 0, &txs)
                .unwrap(),
        );
    }

    // Fork A from main[8] (blue score 8): five blocks makes its tip score 13.
    let a_base = main[8];
    let mut a_tip = a_base;
    let mut fork_a = Vec::new();
    for i in 0..5 {
        let txs = if i == 0 {
            let tx = transfer(change_out, &alice, &bob.address(), 100, change_value);
            change_out = OutPoint::new(tx.id(), 1);
            change_value -= 100;
            vec![tx]
        } else {
            vec![]
        };
        a_tip = ledger
            .insert(vec![a_tip], 1, 50 + i as u64, 0, &txs)
            .unwrap();
        fork_a.push(a_tip);
    }

    // Fork B from fork_a[2] (blue score 11): five blocks makes its tip score 16,
    // overtaking both fork A and the main chain.
    let b_base = fork_a[2];
    let mut b_tip = b_base;
    for i in 0..5 {
        b_tip = ledger
            .insert(vec![b_tip], 1, 70 + i as u64, 0, &[])
            .unwrap();
    }

    assert_eq!(
        ledger.dag().selected_tip(),
        b_tip,
        "fork B should be the selected tip"
    );

    let threshold = ledger.finality_score();
    for id in ledger.dag().linearize() {
        if ledger.state(&id).is_some() {
            assert_reconstructs(&ledger, &id);
        } else {
            let score = ledger.dag().ghostdag(&id).unwrap().blue_score;
            assert!(score < threshold, "only final blocks lack state: {id}");
        }
    }
}

#[test]
fn parallel_blocks_repeated_double_spends() {
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let carol = KeyPair::from_u64(3);
    let (mut ledger, coin) = funded(u64::MAX, 1_000);
    let genesis = ledger.genesis();

    let mut tip = genesis;
    let mut spendable = coin;
    let mut spendable_value = 1_000u64;

    for round in 0..5 {
        let a = ledger
            .insert(
                vec![tip],
                1,
                round * 10 + 1,
                0,
                &[transfer(
                    spendable,
                    &alice,
                    &bob.address(),
                    100,
                    spendable_value,
                )],
            )
            .unwrap();
        let b = ledger
            .insert(
                vec![tip],
                1,
                round * 10 + 2,
                0,
                &[transfer(
                    spendable,
                    &alice,
                    &carol.address(),
                    100,
                    spendable_value,
                )],
            )
            .unwrap();
        let m = ledger
            .insert(vec![a, b], 1, round * 10 + 3, 0, &[])
            .unwrap();

        for id in [a, b, m] {
            assert_reconstructs(&ledger, &id);
        }

        // Exactly one of the two spends survived in the merge view.
        let merged = ledger.state(&m).unwrap();
        assert_eq!(
            merged.balance(&bob.address()) + merged.balance(&carol.address()),
            100,
            "exactly one parallel spend must survive in round {round}"
        );
        assert_eq!(merged.total_value(), 1_000, "value not conserved");

        // Reclaim the surviving output so the next round can double-spend it again.
        let winner = if merged.balance(&bob.address()) == 100 {
            KeyPair::from_u64(2)
        } else {
            KeyPair::from_u64(3)
        };
        let (win_op, _) = merged
            .iter()
            .find(|(_, o)| o.owner == winner.address() && o.value == 100)
            .expect("winning output");
        let reclaim_tx = transfer(*win_op, &winner, &alice.address(), 100, 100);
        let reclaim = ledger
            .insert(
                vec![m],
                1,
                round * 10 + 4,
                0,
                std::slice::from_ref(&reclaim_tx),
            )
            .unwrap();
        tip = reclaim;
        spendable = OutPoint::new(reclaim_tx.id(), 0);
        spendable_value = 100;
    }
}

#[test]
fn coinbase_maturity_and_value_conservation() {
    let bob = KeyPair::from_u64(2);
    let carol = KeyPair::from_u64(3);
    let (mut ledger, _coin) = funded(u64::MAX, 1_000);
    let genesis = ledger.genesis();

    // Same-block spend of a coinbase output must be rejected.
    let coinbase =
        Transaction::coinbase(vec![TxOutput::native(100, bob.address())], b"cb1".to_vec());
    let premature_spend = transfer(
        OutPoint::new(coinbase.id(), 0),
        &bob,
        &carol.address(),
        100,
        100,
    );
    assert!(
        ledger
            .insert(vec![genesis], 1, 1, 0, &[coinbase.clone(), premature_spend])
            .is_err(),
        "same-block coinbase spend must be rejected"
    );

    // Coinbase accepted alone; a later block spends the coinbase output after
    // it matures (RFC-006: creation_height 2 → spendable at height 102).
    let cb_id = coinbase.id();
    let b1 = ledger.insert(vec![genesis], 1, 2, 0, &[coinbase]).unwrap();
    let bob_cb = OutPoint::new(cb_id, 0);
    let mut tip = b1;
    for _ in 0..100 {
        tip = ledger.insert(vec![tip], 1, 0, 0, &[]).unwrap();
    }
    let b2 = ledger
        .insert(
            vec![tip],
            1,
            3,
            0,
            &[transfer(bob_cb, &bob, &carol.address(), 100, 100)],
        )
        .unwrap();

    // Genesis 1_000 + coinbase 100 = 1_100 total supply.
    assert_eq!(ledger.state(&b2).unwrap().total_value(), 1_100);

    // Coinbase overspend must be rejected.
    let big_cb = Transaction::coinbase(
        vec![TxOutput::native(2_000, bob.address())],
        b"cb2".to_vec(),
    );
    assert!(
        ledger.insert(vec![b2], 1, 4, 0, &[big_cb]).is_err(),
        "coinbase overspend must be rejected"
    );

    for id in [genesis, b1, b2] {
        assert_reconstructs(&ledger, &id);
    }
}
