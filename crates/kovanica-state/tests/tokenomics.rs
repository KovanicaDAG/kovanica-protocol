//! RFC-006 tokenomics consensus tests.
//!
//! Four groups, all deterministic:
//!
//! * **(a) emission curve** — the subsidy decays geometrically by ×3/4 per era
//!   (Monero/Kaspa-style smooth tail), the closed-form sum is 80M KVNC, and
//!   the curve terminates after 256 eras;
//! * **(b) supply cap** — cumulative native issuance may never exceed
//!   [`MAX_SUPPLY`] (Bitcoin's `MAX_MONEY` analogue), enforced per-view so two
//!   parallel near-cap blocks are each valid in their own view;
//! * **(c) coinbase maturity** — a coinbase output is spendable only at
//!   `created_at + COINBASE_MATURITY` (Bitcoin's `COINBASE_MATURITY` analogue),
//!   genesis coinbases are exempt, the rule holds for mergeset coinbases, and
//!   checkpoint v7 round-trips the coinbase flags + native minted (pre-v7
//!   decodes with empty flags, no panic);
//! * **(d) fee burn** — 3/4 of collected fees are destroyed, 1/4 is credited
//!   to the coinbase allowance (EIP-1559-style burn), and parallel fee
//!   conflicts resolve deterministically at the merge.

use kovanica_state::{
    HalvingSchedule, KeyPair, Ledger, LedgerError, LedgerInsertError, OutPoint, Transaction,
    TxOutput, DEFAULT_HALVING_ERA,
};

/// One KVNC in atoms.
const ATOM: u64 = 100_000_000;
/// Default era length (2M blocks).
const ERA: u64 = DEFAULT_HALVING_ERA;
/// Default RFC-006 schedule: 10 KVNC subsidy, 2M-block eras.
const SCHEDULE: HalvingSchedule = HalvingSchedule::new(10 * ATOM, ERA);
const K: u16 = 3;

/// A ledger whose genesis coinbase mints `funding` to `owner`.
fn funded_ledger(owner: &KeyPair, funding: u64) -> (Ledger, OutPoint) {
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(funding, owner.address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let ledger = Ledger::new(K, SCHEDULE, &[coinbase]).expect("valid genesis");
    (ledger, coin)
}

// ---------------------------------------------------------------------------
// (a) Emission curve
// ---------------------------------------------------------------------------

#[test]
fn emission_decays_geometrically_by_three_quarters_per_era() {
    // s0 = 10 KVNC; each era multiplies by 3/4 (truncated to atoms).
    assert_eq!(SCHEDULE.subsidy_at(0), 10 * ATOM);
    assert_eq!(
        SCHEDULE.subsidy_at(ERA - 1),
        10 * ATOM,
        "era 0 spans [0, ERA)"
    );
    assert_eq!(SCHEDULE.subsidy_at(ERA), 750_000_000); // 7.5 KVNC
    assert_eq!(SCHEDULE.subsidy_at(2 * ERA), 562_500_000); // 5.625 KVNC
    assert_eq!(SCHEDULE.subsidy_at(3 * ERA), 421_875_000); // 4.21875 KVNC
    assert_eq!(SCHEDULE.subsidy_at(4 * ERA), 316_406_250); // 3.1640625 KVNC
}

#[test]
fn emission_closed_form_total_is_80m_kvnc() {
    // Closed form of the geometric series: 4 × genesis_subsidy × era.
    let expected: u128 = 4 * (10 * ATOM) as u128 * ERA as u128; // 80M KVNC
    let mut total: u128 = 0;
    for era in 0..256u64 {
        let subsidy = SCHEDULE.subsidy_at(era * ERA) as u128;
        total += subsidy * ERA as u128;
    }
    // Per-era truncation to atoms: each step loses < 1 atom, and the error
    // compounds as e_{n+1} < (3/4)e_n + 1, so each era's subsidy is within 4
    // atoms of the exact geometric value. The sum error is therefore bounded
    // by 256 eras × 4 atoms × ERA blocks.
    let max_truncation_error: u128 = 256 * 4 * ERA as u128;
    assert!(
        total <= expected,
        "sum {total} exceeds closed form {expected}"
    );
    assert!(
        expected - total < max_truncation_error,
        "sum {total} too far below closed form {expected}"
    );
}

#[test]
fn emission_is_monotone_and_terminates_after_256_eras() {
    let mut prev = SCHEDULE.subsidy_at(0);
    let mut last_nonzero_era = 0;
    for era in 1..=256u64 {
        let s = SCHEDULE.subsidy_at(era * ERA);
        assert!(s <= prev, "subsidy must never increase");
        if s > 0 {
            last_nonzero_era = era;
        }
        prev = s;
    }
    assert!(
        last_nonzero_era < 256,
        "curve should be exhausted before era 256"
    );
    assert_eq!(SCHEDULE.subsidy_at(256 * ERA), 0);
    // No hang at extreme heights: era overflows to >= 256 and returns 0.
    assert_eq!(SCHEDULE.subsidy_at(u64::MAX), 0);
}

// ---------------------------------------------------------------------------
// (b) Supply cap
// ---------------------------------------------------------------------------

#[test]
fn supply_cap_rejects_coinbase_past_max_supply() {
    // A schedule whose per-block subsidy (500M KVNC) is large enough that two
    // blocks of issuance push cumulative minted past MAX_SUPPLY (902M KVNC).
    const BIG: HalvingSchedule = HalvingSchedule::new(500_000_000 * ATOM, ERA);
    let miner = KeyPair::from_u64(1);
    let genesis_cb = Transaction::coinbase(
        vec![TxOutput::native(ATOM, miner.address())], // 1 KVNC
        b"genesis".to_vec(),
    );
    let mut ledger = Ledger::new(K, BIG, &[genesis_cb]).unwrap();
    let genesis = ledger.genesis();

    // Block 1: claim the full 500M KVNC subsidy — cumulative 500,000,001 KVNC
    // is still under the 902M KVNC cap.
    let cb1 = Transaction::coinbase(
        vec![TxOutput::native(500_000_000 * ATOM, miner.address())],
        b"cb1".to_vec(),
    );
    let b1 = ledger.insert(vec![genesis], 1, 0, 0, &[cb1]).unwrap();

    // Block 2: claiming the full subsidy again would push cumulative minted to
    // 1,000,000,001 KVNC > 902M KVNC — rejected at insert.
    let cb2 = Transaction::coinbase(
        vec![TxOutput::native(500_000_000 * ATOM, miner.address())],
        b"cb2".to_vec(),
    );
    let err = ledger.insert(vec![b1], 1, 0, 0, &[cb2]).unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::SupplyCapExceeded { .. })
    ));
    // The rejected block never entered the DAG.
    assert_eq!(ledger.dag().len(), 2, "genesis + b1 only");
}

#[test]
fn parallel_blocks_near_the_cap_are_each_valid_in_their_own_view() {
    // Two parallel blocks each claim the full 500M KVNC subsidy. Each is valid
    // in its own view (neither sees the other's minting), so both are admitted;
    // a merger applies only the first in mergeset order — the second's coinbase
    // would exceed the cap in the merged view and is dropped.
    const BIG: HalvingSchedule = HalvingSchedule::new(500_000_000 * ATOM, ERA);
    let miner = KeyPair::from_u64(1);
    let genesis_cb = Transaction::coinbase(
        vec![TxOutput::native(ATOM, miner.address())],
        b"genesis".to_vec(),
    );
    let mut ledger = Ledger::new(K, BIG, &[genesis_cb]).unwrap();
    let genesis = ledger.genesis();

    let cb1 = Transaction::coinbase(
        vec![TxOutput::native(500_000_000 * ATOM, miner.address())],
        b"cb1".to_vec(),
    );
    let cb2 = Transaction::coinbase(
        vec![TxOutput::native(500_000_000 * ATOM, miner.address())],
        b"cb2".to_vec(),
    );
    let b1 = ledger.insert(vec![genesis], 1, 0, 0, &[cb1]).unwrap();
    let b2 = ledger.insert(vec![genesis], 1, 0, 0, &[cb2]).unwrap();
    assert!(ledger.dag().contains(&b1));
    assert!(ledger.dag().contains(&b2));

    // Merge: exactly one of the two coinbases takes effect (the other would
    // exceed the cap in the merged view). Total supply = 1 + 500M KVNC.
    let merge = ledger.insert(vec![b1, b2], 5, 0, 0, &[]).unwrap();
    let state = ledger.state(&merge).unwrap();
    assert_eq!(state.total_value(), (500_000_001 * ATOM) as u128);
}

// ---------------------------------------------------------------------------
// (c) Coinbase maturity
// ---------------------------------------------------------------------------

#[test]
fn coinbase_output_is_immature_until_100_blocks_old() {
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let miner = KeyPair::from_u64(3);
    let (mut ledger, _genesis_coin) = funded_ledger(&alice, 10 * ATOM);
    let genesis = ledger.genesis();

    // Block 1 (height 1): miner mints the subsidy coinbase to themselves.
    let cb1 = Transaction::coinbase(
        vec![TxOutput::native(SCHEDULE.subsidy_at(1), miner.address())],
        b"cb1".to_vec(),
    );
    let miner_coin = OutPoint::new(cb1.id(), 0);
    let b1 = ledger.insert(vec![genesis], 1, 0, 0, &[cb1]).unwrap();

    // Advance to height 99 (98 empty blocks after b1).
    let mut tip = b1;
    for _ in 0..98 {
        tip = ledger.insert(vec![tip], 1, 0, 0, &[]).unwrap();
    }
    assert_eq!(ledger.dag().ghostdag(&tip).unwrap().blue_score, 99);

    // Spend at height 100: age 99 < 100 → immature.
    let early = Transaction::signed(
        &[(miner_coin, &miner)],
        vec![
            TxOutput::native(1, bob.address()),
            TxOutput::native(SCHEDULE.subsidy_at(1) - 1, miner.address()),
        ],
        b"early".to_vec(),
    );
    let err = ledger.insert(vec![tip], 1, 0, 0, &[early]).unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::CoinbaseImmature { .. })
    ));

    // One more empty block → height 100; spend at height 101: age 100 → final.
    tip = ledger.insert(vec![tip], 1, 0, 0, &[]).unwrap();
    let late = Transaction::signed(
        &[(miner_coin, &miner)],
        vec![
            TxOutput::native(1, bob.address()),
            TxOutput::native(SCHEDULE.subsidy_at(1) - 1, miner.address()),
        ],
        b"late".to_vec(),
    );
    ledger.insert(vec![tip], 1, 0, 0, &[late]).unwrap();
    assert_eq!(ledger.ledger_state().balance(&bob.address()), 1);
}

#[test]
fn genesis_coinbase_is_exempt_from_maturity() {
    // The founder premine (genesis coinbase) is spendable immediately — it is
    // the initial allocation, not a block reward (`created_at == 0` exempts it).
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let (mut ledger, coin) = funded_ledger(&alice, 10 * ATOM);
    let genesis = ledger.genesis();

    let spend = Transaction::signed(
        &[(coin, &alice)],
        vec![
            TxOutput::native(100, bob.address()),
            TxOutput::native(10 * ATOM - 100, alice.address()),
        ],
        b"spend".to_vec(),
    );
    ledger.insert(vec![genesis], 1, 0, 0, &[spend]).unwrap();
    assert_eq!(ledger.ledger_state().balance(&bob.address()), 100);
}

#[test]
fn immature_coinbase_from_a_mergeset_block_is_rejected_in_the_merger_view() {
    // A coinbase minted by a parallel (mergeset) block is subject to the same
    // maturity rule: a merger at height 2 spending the height-1 coinbase is
    // immature (age 1) and rejected at insert.
    let miner = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let (mut ledger, _genesis_coin) = funded_ledger(&miner, 10 * ATOM);
    let genesis = ledger.genesis();

    // b1 mints a coinbase; b2 is a parallel empty block.
    let cb1 = Transaction::coinbase(
        vec![TxOutput::native(SCHEDULE.subsidy_at(1), miner.address())],
        b"cb1".to_vec(),
    );
    let miner_coin = OutPoint::new(cb1.id(), 0);
    let b1 = ledger.insert(vec![genesis], 1, 0, 0, &[cb1]).unwrap();
    let b2 = ledger.insert(vec![genesis], 1, 0, 0, &[]).unwrap();

    // A merger at height 2 sees the height-1 coinbase via its mergeset;
    // spending it is immature and rejected at insert.
    let spend = Transaction::signed(
        &[(miner_coin, &miner)],
        vec![
            TxOutput::native(1, bob.address()),
            TxOutput::native(SCHEDULE.subsidy_at(1) - 1, miner.address()),
        ],
        b"spend".to_vec(),
    );
    let err = ledger.insert(vec![b1, b2], 1, 0, 0, &[spend]).unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::CoinbaseImmature { .. })
    ));
}

#[test]
fn checkpoint_roundtrip_preserves_coinbase_flags_and_minted() {
    let alice = KeyPair::from_u64(1);
    let miner = KeyPair::from_u64(3);
    let genesis_cb = Transaction::coinbase(
        vec![TxOutput::native(10 * ATOM, alice.address())],
        b"genesis".to_vec(),
    );
    let mut ledger = Ledger::with_finality(K, SCHEDULE, &[genesis_cb], 2).unwrap();
    let mut tip = ledger.genesis();
    let mut first_miner_coin = None;
    for i in 0..5u64 {
        let cb = Transaction::coinbase(
            vec![TxOutput::native(
                SCHEDULE.subsidy_at(i + 1),
                miner.address(),
            )],
            format!("cb{i}").into_bytes(),
        );
        if i == 0 {
            first_miner_coin = Some(OutPoint::new(cb.id(), 0));
        }
        tip = ledger.insert(vec![tip], 1, 0, 0, &[cb]).unwrap();
    }
    assert!(ledger.finality_score() > 0, "finality should be active");
    let miner_coin = first_miner_coin.unwrap();

    let buf = ledger.write_checkpoint().unwrap();
    let mut restored = Ledger::read_checkpoint(&buf).unwrap();

    // Native minted survives: the restored total supply matches the original.
    assert_eq!(
        restored.ledger_state().total_value(),
        ledger.ledger_state().total_value()
    );

    // The height-1 coinbase (in the checkpoint UTXO set) keeps its coinbase
    // flag and creation height, so maturity still applies after restore.
    let restored_state = restored.state(&restored.dag().selected_tip()).unwrap();
    assert!(restored_state.is_coinbase_created(&miner_coin));
    assert_eq!(restored_state.created_at_of(&miner_coin), Some(1));

    // And it is still enforced: spending at height 100 (age 99) is immature.
    let mut tip = restored.dag().selected_tip();
    for _ in 0..94 {
        tip = restored.insert(vec![tip], 1, 0, 0, &[]).unwrap();
    }
    let spend = Transaction::signed(
        &[(miner_coin, &miner)],
        vec![
            TxOutput::native(1, alice.address()),
            TxOutput::native(SCHEDULE.subsidy_at(1) - 1, miner.address()),
        ],
        b"spend".to_vec(),
    );
    let err = restored.insert(vec![tip], 1, 0, 0, &[spend]).unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::CoinbaseImmature { .. })
    ));
}

/// Rewrite a v7 checkpoint blob as a v6 blob: version field → 6, drop the
/// per-output coinbase flag byte and the trailing native-minted field.
fn downgrade_checkpoint_to_v6(v7: &[u8]) -> Vec<u8> {
    // Header: magic(4) + version(2) + k(2) + 5×u64(40) = 48 bytes.
    let mut out = v7[..6].to_vec();
    out[4..6].copy_from_slice(&6u16.to_le_bytes());
    out.extend_from_slice(&v7[6..48]);
    let mut pos = 48;

    // UTXO set: count(8) + per-output records.
    let count = u64::from_le_bytes(v7[pos..pos + 8].try_into().unwrap()) as usize;
    out.extend_from_slice(&v7[pos..pos + 8]);
    pos += 8;
    for _ in 0..count {
        let start = pos;
        pos += 77; // txid(32) + index(4) + value(8) + owner(33)
        let asset_flag = v7[pos];
        pos += 1;
        if asset_flag == 1 {
            pos += 32;
        }
        let stealth_flag = v7[pos];
        pos += 1;
        if stealth_flag == 1 {
            pos += 65;
        }
        pos += 8; // created_at
        out.extend_from_slice(&v7[start..pos]);
        pos += 1; // drop the v7 coinbase flag byte
    }
    // Drop the v7 native-minted field (8 bytes); keep stake + tip segment.
    out.extend_from_slice(&v7[pos + 8..]);
    out
}

#[test]
fn pre_v7_checkpoint_decodes_with_empty_coinbase_flags() {
    let alice = KeyPair::from_u64(1);
    let miner = KeyPair::from_u64(3);
    let genesis_cb = Transaction::coinbase(
        vec![TxOutput::native(10 * ATOM, alice.address())],
        b"genesis".to_vec(),
    );
    let mut ledger = Ledger::with_finality(K, SCHEDULE, &[genesis_cb], 2).unwrap();
    let mut tip = ledger.genesis();
    let mut first_miner_coin = None;
    for i in 0..5u64 {
        let cb = Transaction::coinbase(
            vec![TxOutput::native(
                SCHEDULE.subsidy_at(i + 1),
                miner.address(),
            )],
            format!("cb{i}").into_bytes(),
        );
        if i == 0 {
            first_miner_coin = Some(OutPoint::new(cb.id(), 0));
        }
        tip = ledger.insert(vec![tip], 1, 0, 0, &[cb]).unwrap();
    }
    assert!(ledger.finality_score() > 0);
    let miner_coin = first_miner_coin.unwrap();

    let v7 = ledger.write_checkpoint().unwrap();
    let v6 = downgrade_checkpoint_to_v6(&v7);

    // A v6 checkpoint decodes without panic; checkpoint-state outputs carry no
    // coinbase flags (the network resets at RFC-006 activation, so legacy data
    // is maturity-free).
    let restored = Ledger::read_checkpoint(&v6).unwrap();
    let state = restored.state(&restored.dag().selected_tip()).unwrap();
    assert!(
        !state.is_coinbase_created(&miner_coin),
        "pre-v7 checkpoint-state coinbase must not be flagged"
    );
}

// ---------------------------------------------------------------------------
// (d) Fee burn
// ---------------------------------------------------------------------------

#[test]
fn fee_burn_destroys_three_quarters_of_fees() {
    // Subsidy 1_000 atoms; a transfer leaves a fee of 1_000 atoms. The coinbase
    // allowance is subsidy + fees/4 = 1_250 atoms; the other 750 atoms are
    // destroyed, so the post-block supply is genesis + 1_250, not + 2_000.
    const SMALL: HalvingSchedule = HalvingSchedule::new(1_000, ERA);
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let miner = KeyPair::from_u64(3);
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(1_000, alice.address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let mut ledger = Ledger::new(K, SMALL, &[coinbase]).unwrap();
    let genesis = ledger.genesis();

    // alice → bob 800, 100 change: fee = 100.
    let transfer = Transaction::signed(
        &[(coin, &alice)],
        vec![
            TxOutput::native(800, bob.address()),
            TxOutput::native(100, alice.address()),
        ],
        b"transfer".to_vec(),
    );
    // Coinbase claims subsidy + fees/4 = 1_000 + 25 = 1_025.
    let cb = Transaction::coinbase(
        vec![TxOutput::native(1_025, miner.address())],
        b"cb".to_vec(),
    );
    ledger
        .insert(vec![genesis], 1, 0, 0, &[cb, transfer])
        .unwrap();

    let state = ledger.ledger_state();
    assert_eq!(state.balance(&bob.address()), 800);
    assert_eq!(state.balance(&alice.address()), 100);
    assert_eq!(state.balance(&miner.address()), 1_025);
    // The genesis coin (1_000) is spent by the transfer (creates 900);
    // the coinbase mints 1_025. Without the burn the coinbase could claim
    // 1_100, so the 75 destroyed atoms are exactly 3/4 of the 100 fee.
    assert_eq!(state.total_value(), 1_925);

    // Claiming 1_026 overspends the allowance.
    let coinbase2 = Transaction::coinbase(
        vec![TxOutput::native(1_000, alice.address())],
        b"genesis".to_vec(),
    );
    let coin2 = OutPoint::new(coinbase2.id(), 0);
    let mut ledger2 = Ledger::new(K, SMALL, &[coinbase2]).unwrap();
    let genesis2 = ledger2.genesis();
    let transfer2 = Transaction::signed(
        &[(coin2, &alice)],
        vec![
            TxOutput::native(800, bob.address()),
            TxOutput::native(100, alice.address()),
        ],
        b"transfer".to_vec(),
    );
    let greedy = Transaction::coinbase(
        vec![TxOutput::native(1_026, miner.address())],
        b"cb".to_vec(),
    );
    let err = ledger2
        .insert(vec![genesis2], 1, 0, 0, &[greedy, transfer2])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::CoinbaseOverspend { .. })
    ));
}

#[test]
fn parallel_fee_conflicts_resolve_deterministically_at_merge() {
    // Two parallel blocks each spend the genesis coin with a 1_000-atom fee and
    // claim subsidy + fees/4. Each is valid in its own view; the merger applies
    // only the first in mergeset order, so exactly one recipient is paid and
    // exactly one coinbase's minted value survives.
    const SMALL: HalvingSchedule = HalvingSchedule::new(1_000, ERA);
    let alice = KeyPair::from_u64(1);
    let bob = KeyPair::from_u64(2);
    let carol = KeyPair::from_u64(3);
    let miner = KeyPair::from_u64(4);
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(1_000, alice.address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let mut ledger = Ledger::new(K, SMALL, &[coinbase]).unwrap();
    let genesis = ledger.genesis();

    let to_bob = Transaction::signed(
        &[(coin, &alice)],
        vec![
            TxOutput::native(800, bob.address()),
            TxOutput::native(100, alice.address()),
        ],
        b"to_bob".to_vec(),
    );
    let to_carol = Transaction::signed(
        &[(coin, &alice)],
        vec![
            TxOutput::native(700, carol.address()),
            TxOutput::native(200, alice.address()),
        ],
        b"to_carol".to_vec(),
    );
    let cb1 = Transaction::coinbase(
        vec![TxOutput::native(1_025, miner.address())],
        b"cb1".to_vec(),
    );
    let cb2 = Transaction::coinbase(
        vec![TxOutput::native(1_025, miner.address())],
        b"cb2".to_vec(),
    );
    let b1 = ledger
        .insert(vec![genesis], 1, 0, 0, &[cb1, to_bob])
        .unwrap();
    let b2 = ledger
        .insert(vec![genesis], 1, 0, 0, &[cb2, to_carol])
        .unwrap();

    let merge = ledger.insert(vec![b1, b2], 5, 0, 0, &[]).unwrap();
    let state = ledger.state(&merge).unwrap();
    let bob_bal = state.balance(&bob.address());
    let carol_bal = state.balance(&carol.address());
    assert_eq!(bob_bal + carol_bal, 800, "exactly one recipient is paid");
    assert!(bob_bal == 0 || carol_bal == 0);
    // Supply: the spent genesis coin (1_000) becomes the winner's 900
    // outputs + one surviving coinbase 1_025.
    assert_eq!(state.total_value(), 1_925);
}
