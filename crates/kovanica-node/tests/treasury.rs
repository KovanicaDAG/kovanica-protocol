//! RFC-006 §5 treasury vesting test suite.
//!
//! Tests the genesis treasury vesting via RFC-005 vault composition: the
//! genesis coinbase emits the founder premine plus `tranches` vault outputs,
//! each locking `tranche_amount` behind an absolute-time vault. Tranche k
//! (1-based) unlocks at height `k × tranche_interval`.
//!
//! Reference protocol: RFC-005 vault composition — the treasury is pure
//! composition of existing primitives (no new consensus rules). The RFC-005
//! vault is a two-key template (`beneficiary_pk || owner_pk ||
//! relative_delay u32 LE || absolute_time u32 LE`); the treasury uses
//! `relative_delay = 0` (disabled) and `absolute_time = k × tranche_interval`.
//! The CLAIM path (beneficiary) draws a vested tranche; the RECOVER path
//! (owner) is the pre-vesting clawback control.

use kovanica_node::{Node, TreasuryConfig};
use kovanica_state::vault::VaultScript;
use kovanica_state::{
    Address, HalvingSchedule, KeyPair, Ledger, LedgerError, LedgerInsertError, OutPoint,
    Transaction, TxInput, TxOutput, DEFAULT_HALVING_ERA,
};

/// One KVNC in atoms.
const ATOM: u64 = 100_000_000;

// ---------------------------------------------------------------------------
// 1. Genesis with treasury emits premine + 10 vault tranches
// ---------------------------------------------------------------------------

/// Size of each tranche in test units.
const TRANCHE_AMOUNT: u64 = 1_000 * ATOM;
/// Number of tranches.
const TRANCHES: u32 = 10;
/// Interval between tranche unlocks (small, for test speed).
const INTERVAL: u32 = 100;
/// Founder premine.
const PREMINE: u64 = 200 * ATOM;
/// Subsidy set high enough to cover premine + treasury (required because
/// `apply_coinbase` enforces `claimed_native <= subsidy + fees/4` and the
/// RFC-006 genesis-exemption has not yet landed — see the genesis builder's
/// doc comment).
const SUBSIDY: u64 = PREMINE + (TRANCHE_AMOUNT * TRANCHES as u64);
const K: u16 = 3;

#[test]
fn genesis_with_treasury_emits_premine_and_vault_tranches() {
    let founder_kp = KeyPair::from_u64(1);
    let beneficiary_pk = TreasuryConfig::placeholder_beneficiary_pk();
    let owner_pk = TreasuryConfig::placeholder_owner_pk();
    let treasury = TreasuryConfig {
        tranche_amount: TRANCHE_AMOUNT,
        tranches: TRANCHES,
        tranche_interval: INTERVAL,
        beneficiary_pk,
        owner_pk,
    };

    let mut node = Node::new();
    let (genesis_id, founder) = node
        .genesis_with_finality_and_treasury(
            K,
            SUBSIDY,
            PREMINE,
            1,    // founder_seed
            100,  // finality_depth
            1000, // payload_pruning_depth
            Some(treasury),
        )
        .expect("genesis with treasury");

    assert_eq!(founder, founder_kp.address());

    // Founder has the premine.
    assert_eq!(node.balance(&founder).unwrap(), PREMINE.into());

    // Each tranche is locked in a vault; verify balances and script shape.
    let mut total_vault_value: u64 = 0;
    for k_idx in 1..=TRANCHES {
        let script =
            VaultScript::new(beneficiary_pk, owner_pk, 0, k_idx * INTERVAL).expect("valid vault");
        assert_eq!(
            script.absolute_time(),
            k_idx * INTERVAL,
            "tranche {k_idx} must unlock at k × interval"
        );
        assert_eq!(script.relative_delay(), 0, "treasury vaults are pure CLTV");
        assert_eq!(script.beneficiary_pk(), &beneficiary_pk);
        assert_eq!(script.owner_pk(), &owner_pk);
        let vault_balance = node.balance_of_vault(&script);
        assert_eq!(
            vault_balance, TRANCHE_AMOUNT,
            "tranche {k_idx} must hold {TRANCHE_AMOUNT}"
        );
        total_vault_value += vault_balance;
    }

    // Total minted = premine + tranches × tranche_amount (the genesis
    // `native_minted` counter is the sum of the coinbase's native outputs).
    let supply = node.balance(&founder).unwrap() + u128::from(total_vault_value);
    let expected_minted = u128::from(PREMINE) + u128::from(TRANCHE_AMOUNT) * u128::from(TRANCHES);
    assert_eq!(
        supply, expected_minted,
        "total supply must equal premine + tranches"
    );

    // Verify genesis block id was returned (non-zero).
    assert_ne!(genesis_id, kovanica_dag::BlockId::from_bytes([0u8; 32]));
}

// ---------------------------------------------------------------------------
// 2. Tranche release boundaries
// ---------------------------------------------------------------------------

/// Helper: create a ledger with a single vault tranche at `absolute_time`,
/// returning the ledger, the vault outpoint, the vault script, and the
/// beneficiary + owner keypairs.
fn treasury_vault_at(absolute_time: u32) -> (Ledger, OutPoint, VaultScript, KeyPair, KeyPair) {
    let beneficiary_kp = KeyPair::from_u64(9998);
    let owner_kp = KeyPair::from_u64(9999);
    let script = VaultScript::new(
        *beneficiary_kp.address().payload(),
        *owner_kp.address().payload(),
        0,
        absolute_time,
    )
    .expect("valid vault");

    let coinbase = Transaction::coinbase(
        vec![
            TxOutput::native(100, KeyPair::from_u64(1).address()),
            TxOutput::native(500, script.address()),
        ],
        b"genesis".to_vec(),
    );
    let vault_coin = OutPoint::new(coinbase.id(), 1);
    let schedule = HalvingSchedule::new(1_000, DEFAULT_HALVING_ERA);
    let ledger = Ledger::new(K, schedule, &[coinbase]).expect("genesis");
    (ledger, vault_coin, script, beneficiary_kp, owner_kp)
}

/// Extend a ledger by `n` empty blocks.
fn extend_chain(ledger: &mut Ledger, n: u64) {
    for _ in 0..n {
        ledger
            .insert(vec![ledger.dag().selected_tip()], 1, 0, 0, &[])
            .unwrap();
    }
}

/// Build a vault **CLAIM** spend (beneficiary signature, valid only after the
/// lock expires): witness = [template, 0x01, beneficiary_sig].
fn build_vault_claim(
    outpoint: OutPoint,
    script: &VaultScript,
    beneficiary_kp: &KeyPair,
    to: Address,
) -> Transaction {
    let dummy = TxInput {
        outpoint,
        witness: Vec::new(),
    };
    let outputs = vec![TxOutput::native(499, to)];
    let mut tx = Transaction::new(vec![dummy], outputs, b"claim".to_vec());
    let sighash = tx.sighash();
    let sig = beneficiary_kp.sign(&sighash);
    tx.inputs_mut()[0].witness = script.claim_witness(sig);
    tx
}

/// Build a vault **RECOVER** spend (owner signature, valid only strictly
/// before the lock expires): witness = [template, 0x02, owner_sig].
fn build_vault_recover(
    outpoint: OutPoint,
    script: &VaultScript,
    owner_kp: &KeyPair,
    to: Address,
) -> Transaction {
    let dummy = TxInput {
        outpoint,
        witness: Vec::new(),
    };
    let outputs = vec![TxOutput::native(499, to)];
    let mut tx = Transaction::new(vec![dummy], outputs, b"recover".to_vec());
    let sighash = tx.sighash();
    let sig = owner_kp.sign(&sighash);
    tx.inputs_mut()[0].witness = script.recover_witness(sig);
    tx
}

#[test]
fn tranche_not_claimable_one_before_unlock_height() {
    // absolute_time = 100: at block height 99 (one before), CLAIM is rejected.
    let (mut ledger, vault_coin, script, beneficiary_kp, _owner_kp) = treasury_vault_at(100);
    extend_chain(&mut ledger, 98); // tip height = 98

    let spend = build_vault_claim(
        vault_coin,
        &script,
        &beneficiary_kp,
        beneficiary_kp.address(),
    );
    let err = ledger
        .insert(
            vec![ledger.dag().selected_tip()],
            1,
            0,
            0,
            std::slice::from_ref(&spend),
        )
        .unwrap_err();
    assert!(
        matches!(
            err,
            LedgerInsertError::State(LedgerError::VaultLockNotExpired { .. })
        ),
        "tranche must NOT be claimable one before unlock_height: got {err:?}"
    );
}

#[test]
fn tranche_claimable_at_unlock_height() {
    // absolute_time = 100: at block height 100 (the boundary), CLAIM succeeds.
    let (mut ledger, vault_coin, script, beneficiary_kp, _owner_kp) = treasury_vault_at(100);
    extend_chain(&mut ledger, 99); // tip height = 99

    let spend = build_vault_claim(
        vault_coin,
        &script,
        &beneficiary_kp,
        beneficiary_kp.address(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 0, 0, &[spend])
        .expect("tranche must be claimable at unlock_height");

    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&beneficiary_kp.address()), 499);
    assert_eq!(utxo.balance(&script.address()), 0);
}

// ---------------------------------------------------------------------------
// 3. Pre-vesting owner spend vs post-vesting claim
// ---------------------------------------------------------------------------

/// Before expiry, the owner can RECOVER (clawback) the vault; the beneficiary
/// cannot CLAIM it yet.
#[test]
fn vault_recover_works_before_expiry() {
    let (mut ledger, vault_coin, script, _beneficiary_kp, owner_kp) = treasury_vault_at(100);
    extend_chain(&mut ledger, 49); // tip height = 49

    let spend = build_vault_recover(vault_coin, &script, &owner_kp, owner_kp.address());
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 0, 0, &[spend])
        .expect("owner must be able to recover before expiry");

    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&owner_kp.address()), 499);
    assert_eq!(utxo.balance(&script.address()), 0);
}

/// After expiry, the beneficiary can CLAIM the vault; the owner cannot RECOVER
/// it any more (claim wins at the boundary).
#[test]
fn vault_claim_works_after_expiry() {
    let (mut ledger, vault_coin, script, beneficiary_kp, _owner_kp) = treasury_vault_at(100);
    extend_chain(&mut ledger, 99); // tip height = 99

    let spend = build_vault_claim(
        vault_coin,
        &script,
        &beneficiary_kp,
        beneficiary_kp.address(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 0, 0, &[spend])
        .expect("beneficiary must be able to claim after expiry");

    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&beneficiary_kp.address()), 499);
    assert_eq!(utxo.balance(&script.address()), 0);
}

/// After expiry, the owner's RECOVER path is rejected (claim wins at the
/// boundary — deterministic escrow soundness).
#[test]
fn vault_recover_rejected_after_expiry() {
    let (mut ledger, vault_coin, script, _beneficiary_kp, owner_kp) = treasury_vault_at(100);
    extend_chain(&mut ledger, 99); // tip height = 99

    let spend = build_vault_recover(vault_coin, &script, &owner_kp, owner_kp.address());
    let err = ledger
        .insert(
            vec![ledger.dag().selected_tip()],
            1,
            0,
            0,
            std::slice::from_ref(&spend),
        )
        .unwrap_err();
    assert!(
        matches!(
            err,
            LedgerInsertError::State(LedgerError::VaultLockExpired { .. })
        ),
        "owner must NOT be able to recover after expiry: got {err:?}"
    );
}

// ---------------------------------------------------------------------------
// 4. TreasuryConfig shape + mainnet params
// ---------------------------------------------------------------------------

#[test]
fn mainnet_treasury_config_params() {
    let mainnet = TreasuryConfig::mainnet();
    assert_eq!(mainnet.tranche_amount, 1_000_000 * ATOM);
    assert_eq!(mainnet.tranches, 10);
    assert_eq!(mainnet.tranche_interval, 31_536_000);
    assert!(mainnet.is_enabled());
    assert_ne!(
        mainnet.beneficiary_pk, [0u8; 32],
        "must be a real placeholder key"
    );
    assert_ne!(
        mainnet.owner_pk, [0u8; 32],
        "must be a real placeholder key"
    );
    assert_ne!(
        mainnet.beneficiary_pk, mainnet.owner_pk,
        "beneficiary and owner keys must differ (VaultScript rejects duplicates)"
    );
}

#[test]
fn treasury_config_disabled_has_zero_tranches() {
    let disabled = TreasuryConfig::disabled();
    assert!(!disabled.is_enabled());
    assert_eq!(disabled.tranches, 0);
    assert_eq!(disabled.tranche_amount, 0);
}

/// Verify placeholder keys are deterministic, non-zero, and distinct.
#[test]
fn placeholder_keys_are_deterministic() {
    let b1 = TreasuryConfig::placeholder_beneficiary_pk();
    let b2 = TreasuryConfig::placeholder_beneficiary_pk();
    let o1 = TreasuryConfig::placeholder_owner_pk();
    let o2 = TreasuryConfig::placeholder_owner_pk();
    assert_eq!(b1, b2, "beneficiary placeholder must be deterministic");
    assert_eq!(o1, o2, "owner placeholder must be deterministic");
    assert_ne!(b1, [0u8; 32], "must not be all-zero");
    assert_ne!(o1, [0u8; 32], "must not be all-zero");
    assert_ne!(b1, o1, "beneficiary and owner placeholders must differ");
}

/// Verify vault scripts for each tranche have the correct unlock heights.
#[test]
fn tranche_vault_scripts_have_correct_unlock_heights() {
    let beneficiary_pk = TreasuryConfig::placeholder_beneficiary_pk();
    let owner_pk = TreasuryConfig::placeholder_owner_pk();
    let cfg = TreasuryConfig {
        tranche_amount: 1_000 * ATOM,
        tranches: 5,
        tranche_interval: 100,
        beneficiary_pk,
        owner_pk,
    };

    for k in 1..=cfg.tranches {
        let abs_time = k * cfg.tranche_interval;
        let script = VaultScript::new(beneficiary_pk, owner_pk, 0, abs_time).expect("valid");
        assert_eq!(script.absolute_time(), abs_time);
        assert_eq!(script.relative_delay(), 0);
        assert_eq!(script.beneficiary_pk(), &beneficiary_pk);
        assert_eq!(script.owner_pk(), &owner_pk);
    }
}

// ---------------------------------------------------------------------------
// 5. Disable treasury → genesis has only premine, no vault outputs
// ---------------------------------------------------------------------------

#[test]
fn genesis_without_treasury_has_only_premine() {
    let mut node = Node::new();
    let (_genesis, founder) = node
        .genesis_with_finality_and_treasury(
            K, 1_000, 1_000, 1, 100, 1000, None, // no treasury
        )
        .expect("genesis without treasury");

    assert_eq!(node.balance(&founder).unwrap(), 1_000);
}
