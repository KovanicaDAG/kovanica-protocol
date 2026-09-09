//! RFC-005 consensus test suite: time-lock vault / escrow.
//!
//! 29 tests.
//!
//! Vault (RFC-005): outputs locked to a v0x05 address (BLAKE3 of a 72-byte
//! template: `beneficiary_pk || owner_pk || relative_delay u32 LE ||
//! absolute_time u32 LE`). Spends are discriminated by a path byte —
//! `0x01` CLAIM (beneficiary signature, only after the lock expires) and
//! `0x02` RECOVER (owner signature, only strictly before the lock expires;
//! claim wins at the boundary).
//!
//! The lock expires iff `height >= absolute_time` AND
//! `height - created_at >= relative_delay`; either field `0` disables that half
//! (pure CLTV / pure CSV / both). Creation heights are tracked per-UTXO
//! (checkpoint v6) and survive prune-folding and checkpoint/snapshot restore.
//!
//! Reference protocols: BIP-112 (CSV), BIP-68 (relative locktime),
//! BIP-65/BIP-113 (CLTV), Bitcoin time-locked escrow / inheritance vaults.
//! The template/address shape mirrors RFC-001 P2SH, RFC-003 script v2, and
//! RFC-004 HTLC; activation gating mirrors RFC-001/002/003/004.
//!
//! Activation gating: `blue_score <= activation_score` is pre-activation
//! (outputs and spends rejected). Genesis is blue score 0; the first inserted
//! block is blue score 1. Coinbase outputs are exempt from the vault output
//! gate (mirroring the HTLC/stealth/script-v2/native-token coinbase
//! exemption), so genesis can fund a vault address directly.

use kovanica_state::ledger::VAULT_ACTIVATION_SCORE;
use kovanica_state::vault::{VaultScript, VAULT_PATH_CLAIM};
use kovanica_state::{
    apply_block, Address, HalvingSchedule, KeyPair, Ledger, LedgerError, LedgerInsertError,
    OutPoint, Transaction, TxId, TxInput, TxOutput, UtxoSet, DEFAULT_HALVING_ERA,
};

const K: u16 = 3;
const SUBSIDY: u64 = 1_000;
const SCHEDULE: HalvingSchedule = HalvingSchedule::new(SUBSIDY, DEFAULT_HALVING_ERA);

fn generate_key(count: usize) -> KeyPair {
    KeyPair::from_u64((1000 + count) as u64)
}

/// Build a validated vault template from two parties and a lock.
fn make_vault(
    beneficiary: &KeyPair,
    owner: &KeyPair,
    relative_delay: u32,
    absolute_time: u32,
) -> VaultScript {
    VaultScript::new(
        *beneficiary.address().payload(),
        *owner.address().payload(),
        relative_delay,
        absolute_time,
    )
    .expect("valid vault template")
}

/// A ledger whose genesis coinbase funds a vault address (coinbase exempt from
/// the output gate).
fn vault_funded_ledger(script: &VaultScript, funding: u64) -> (Ledger, OutPoint) {
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(funding, script.address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let ledger = Ledger::new(K, SCHEDULE, &[coinbase]).expect("valid genesis");
    (ledger, coin)
}

/// A ledger whose genesis coinbase funds a P2PK address.
fn funded_ledger(owner: Address, funding: u64) -> (Ledger, OutPoint) {
    let coinbase =
        Transaction::coinbase(vec![TxOutput::native(funding, owner)], b"genesis".to_vec());
    let coin = OutPoint::new(coinbase.id(), 0);
    let ledger = Ledger::new(K, SCHEDULE, &[coinbase]).expect("valid genesis");
    (ledger, coin)
}

/// Build a vault CLAIM: witness = [template, 0x01, beneficiary_sig].
fn build_vault_claim(
    outpoint: OutPoint,
    script: &VaultScript,
    beneficiary_kp: &KeyPair,
    outputs: Vec<TxOutput>,
    tag: Vec<u8>,
) -> Transaction {
    let dummy_input = TxInput {
        outpoint,
        witness: Vec::new(),
    };
    let mut tx = Transaction::new(vec![dummy_input], outputs, tag);
    let sighash = tx.sighash();
    let sig = beneficiary_kp.sign(&sighash);
    tx.inputs_mut()[0].witness = script.claim_witness(sig);
    tx
}

/// Build a vault RECOVER: witness = [template, 0x02, owner_sig].
fn build_vault_recover(
    outpoint: OutPoint,
    script: &VaultScript,
    owner_kp: &KeyPair,
    outputs: Vec<TxOutput>,
    tag: Vec<u8>,
) -> Transaction {
    let dummy_input = TxInput {
        outpoint,
        witness: Vec::new(),
    };
    let mut tx = Transaction::new(vec![dummy_input], outputs, tag);
    let sighash = tx.sighash();
    let sig = owner_kp.sign(&sighash);
    tx.inputs_mut()[0].witness = script.recover_witness(sig);
    tx
}

/// Build a signed P2PK spend with explicit lock time and sequence (for the
/// BIP-112 consensus-rule tests).
fn build_signed_with_lock(
    outpoint: OutPoint,
    kp: &KeyPair,
    outputs: Vec<TxOutput>,
    tag: Vec<u8>,
    n_lock_time: u32,
    sequence: u32,
) -> Transaction {
    let dummy_input = TxInput {
        outpoint,
        witness: Vec::new(),
    };
    let mut tx = Transaction::new_with_lock(vec![dummy_input], outputs, tag, n_lock_time, sequence);
    let sighash = tx.sighash();
    let sig = kp.sign(&sighash);
    tx.inputs_mut()[0].witness = vec![sig.to_vec()];
    tx
}

/// Mine `n` empty blocks on the selected tip, returning the new tip.
fn mine_blocks(ledger: &mut Ledger, n: u64, start_height: u64) -> kovanica_dag::BlockId {
    let mut tip = ledger.dag().selected_tip();
    for h in start_height..start_height + n {
        tip = ledger.insert(vec![tip], 1, h, 0, &[]).unwrap();
    }
    tip
}

// =========================================================================
// Template & address — 4 tests
// =========================================================================

#[test]
fn vault_template_roundtrip() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 20);

    assert_eq!(script.relative_delay(), 10);
    assert_eq!(script.absolute_time(), 20);
    assert_eq!(script.beneficiary_pk(), beneficiary.address().payload());
    assert_eq!(script.owner_pk(), owner.address().payload());

    let bytes = script.bytes();
    assert_eq!(bytes.len(), 72);
    let parsed = VaultScript::parse(&bytes).unwrap();
    assert_eq!(parsed, script);
    assert_eq!(parsed.script_hash(), script.script_hash());
    assert_eq!(parsed.address(), script.address());
    assert_eq!(parsed.address().version(), Address::VERSION_VAULT);
    assert!(parsed.address().is_vault());
    assert_eq!(parsed.encode(), bytes.to_vec());
}

#[test]
fn vault_wrong_length_rejected() {
    let err = VaultScript::parse(&[0u8; 71]).unwrap_err();
    assert_eq!(err.to_string(), "vault script must be 72 bytes");
    assert!(VaultScript::parse(&[0u8; 73]).is_err());
}

#[test]
fn vault_invalid_keys_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    // y=2 (bytes [0x02, 0, …, 0]) is NOT on the Ed25519 curve.
    let invalid = [0x02u8; 32];

    assert!(VaultScript::new(invalid, *owner.address().payload(), 0, 0).is_err());
    assert!(VaultScript::new(*beneficiary.address().payload(), invalid, 0, 0).is_err());
}

#[test]
fn vault_duplicate_keys_rejected() {
    let beneficiary = generate_key(1);
    let pk = *beneficiary.address().payload();
    assert!(VaultScript::new(pk, pk, 0, 0).is_err());
}

// =========================================================================
// Claim path — 5 tests
// =========================================================================

#[test]
fn vault_claim_after_pure_csv_delay() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 0); // pure CSV
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Mine the relative delay, then claim.
    mine_blocks(&mut ledger, 10, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"claim".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 11, 0, &[claim])
        .unwrap();

    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
    assert_eq!(utxo.balance(&script.address()), 0);
}

#[test]
fn vault_claim_before_relative_delay_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 0); // pure CSV
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Claim after only 5 blocks: age 5 < 10 → not expired.
    mine_blocks(&mut ledger, 5, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"early".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 6, 0, &[claim])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::VaultLockNotExpired { .. })
    ));
}

#[test]
fn vault_claim_after_pure_cltv_time() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 20); // pure CLTV
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Mine to the absolute time, then claim.
    mine_blocks(&mut ledger, 20, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"claim".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 21, 0, &[claim])
        .unwrap();

    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
}

#[test]
fn vault_claim_before_absolute_time_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 20); // pure CLTV
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Claim at height 15: 15 < 20 → not expired.
    mine_blocks(&mut ledger, 15, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"early".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 16, 0, &[claim])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::VaultLockNotExpired { .. })
    ));
}

#[test]
fn vault_and_semantics() {
    // AND lock: BOTH halves must be satisfied. relative_delay=10, absolute_time=20.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 20);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // At height 15: age 15 >= 10 ✓ but 15 < 20 ✗ → rejected.
    mine_blocks(&mut ledger, 15, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"and-early".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 16, 0, &[claim])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::VaultLockNotExpired { .. })
    ));

    // At height 20: age 20 >= 10 ✓ AND 20 >= 20 ✓ → claim succeeds.
    mine_blocks(&mut ledger, 4, 16);
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"and-ok".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 21, 0, &[claim])
        .unwrap();
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
}

// =========================================================================
// Recovery path — 4 tests
// =========================================================================

#[test]
fn vault_recover_before_lock() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 20);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Recover at height 5: lock not expired → owner takes the funds back.
    mine_blocks(&mut ledger, 5, 1);
    let alice = generate_key(3).address();
    let recover = build_vault_recover(
        coin,
        &script,
        &owner,
        vec![TxOutput::native(900, alice)],
        b"recover".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 6, 0, &[recover])
        .unwrap();

    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&alice), 900);
}

#[test]
fn vault_recover_after_lock_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 20);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Recover at height 25: lock expired → only claim is valid.
    mine_blocks(&mut ledger, 25, 1);
    let alice = generate_key(3).address();
    let recover = build_vault_recover(
        coin,
        &script,
        &owner,
        vec![TxOutput::native(900, alice)],
        b"late-recover".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 26, 0, &[recover])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::VaultLockExpired { .. })
    ));
}

#[test]
fn vault_recover_at_boundary_rejected() {
    // At exactly the unlock height, claim wins: recovery is strictly-before.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 20);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Recover at height 20: age 20 >= 10 AND 20 >= 20 → expired → rejected.
    mine_blocks(&mut ledger, 19, 1);
    let alice = generate_key(3).address();
    let recover = build_vault_recover(
        coin,
        &script,
        &owner,
        vec![TxOutput::native(900, alice)],
        b"boundary".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 20, 0, &[recover])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::VaultLockExpired { .. })
    ));

    // The same block height accepts the claim.
    let bob = generate_key(4).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"boundary-claim".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 20, 0, &[claim])
        .unwrap();
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
}

#[test]
fn vault_beneficiary_sig_on_recover_rejected() {
    // The beneficiary's signature is only valid on the CLAIM path.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 20);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Recover path with the beneficiary's signature → BadSignature.
    let dummy_input = TxInput {
        outpoint: coin,
        witness: Vec::new(),
    };
    let mut tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"wrong-sig".to_vec(),
    );
    let sighash = tx.sighash();
    let sig = beneficiary.sign(&sighash);
    tx.inputs_mut()[0].witness = script.recover_witness(sig);

    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::BadSignature { .. })
    ));
}

// =========================================================================
// Witness anomalies — 5 tests
// =========================================================================

#[test]
fn vault_bad_path_byte_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0); // no lock
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    let dummy_input = TxInput {
        outpoint: coin,
        witness: Vec::new(),
    };
    let mut tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"bad-path".to_vec(),
    );
    let sighash = tx.sighash();
    let sig = beneficiary.sign(&sighash);
    tx.inputs_mut()[0].witness = vec![
        script.bytes().to_vec(),
        vec![0x03u8], // reserved path byte
        sig.to_vec(),
    ];

    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::InvalidVaultPath { .. })
    ));
}

#[test]
fn vault_wrong_witness_count_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // 2 elements (missing sig) → InvalidWitnessCount.
    let dummy_input = TxInput {
        outpoint: coin,
        witness: vec![script.bytes().to_vec(), vec![VAULT_PATH_CLAIM]],
    };
    let tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"short".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::InvalidWitnessCount { .. })
    ));

    // 4 elements → InvalidWitnessCount.
    let dummy_input = TxInput {
        outpoint: coin,
        witness: vec![
            script.bytes().to_vec(),
            vec![VAULT_PATH_CLAIM],
            vec![0u8; 64],
            vec![0u8; 64],
        ],
    };
    let tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"long".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::InvalidWitnessCount { .. })
    ));
}

#[test]
fn vault_bad_signature_size_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    let dummy_input = TxInput {
        outpoint: coin,
        witness: vec![
            script.bytes().to_vec(),
            vec![VAULT_PATH_CLAIM],
            vec![0u8; 63], // not 64 bytes
        ],
    };
    let tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"bad-sig".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::BadSignatureSize { .. })
    ));
}

#[test]
fn vault_template_hash_mismatch() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // A different template with the same beneficiary/owner but a different lock.
    let other = make_vault(&beneficiary, &owner, 5, 5);
    let dummy_input = TxInput {
        outpoint: coin,
        witness: Vec::new(),
    };
    let mut tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"hash-mismatch".to_vec(),
    );
    let sighash = tx.sighash();
    let sig = beneficiary.sign(&sighash);
    tx.inputs_mut()[0].witness = other.claim_witness(sig);

    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::ScriptHashMismatch { .. })
    ));
}

#[test]
fn vault_malformed_template_rejected() {
    // A 72-byte template with invalid Ed25519 keys: the address is built from
    // these exact bytes (so the BLAKE3 hash matches on spend), but parse fails
    // → InvalidRedeemScript. (A wrong-length template would fail the hash check
    // first and report ScriptHashMismatch instead.)
    let malformed = [0u8; 72];
    let addr = Address::from_vault_script(&malformed);
    let (mut ledger, coin) = funded_ledger(addr, 1_000);

    let dummy_input = TxInput {
        outpoint: coin,
        witness: vec![malformed.to_vec(), vec![VAULT_PATH_CLAIM], vec![0u8; 64]],
    };
    let tx = Transaction::new(
        vec![dummy_input],
        vec![TxOutput::native(900, generate_key(3).address())],
        b"malformed".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[tx])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::InvalidRedeemScript { .. })
    ));
}

// =========================================================================
// Activation gating — 3 tests
// =========================================================================

#[test]
fn vault_pre_activation_output_rejected() {
    let funder = generate_key(1);
    let beneficiary = generate_key(2);
    let owner = generate_key(3);
    let script = make_vault(&beneficiary, &owner, 10, 20);

    let (mut ledger, coin) = funded_ledger(funder.address(), 1_000);
    ledger.set_vault_activation_score(10);

    // A regular tx creating a vault output at blue_score 1 <= 10 → rejected.
    let send = Transaction::signed(
        &[(coin, &funder)],
        vec![TxOutput::native(900, script.address())],
        b"vault-out".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[send])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::PreActivationVault { .. })
    ));
}

#[test]
fn vault_pre_activation_spend_rejected() {
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0);

    // Genesis coinbase funding a vault address is exempt from the output gate.
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);
    ledger.set_vault_activation_score(10);

    // A vault spend at blue_score 1 <= 10 → rejected.
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, generate_key(3).address())],
        b"pre-activation".to_vec(),
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[claim])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::PreActivationVault { .. })
    ));

    // Post-activation (blue_score 11 > 10) the same spend succeeds.
    mine_blocks(&mut ledger, 10, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"post-activation".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 12, 0, &[claim])
        .unwrap();
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
}

#[test]
fn vault_coinbase_exempt_from_output_gate() {
    // The `vault_funded_ledger` helper itself proves the exemption: genesis is
    // blue score 0 and the default activation score is 0, so a regular tx
    // creating a vault output would be pre-activation — but the coinbase is
    // exempt, so the ledger constructs and the output is spendable.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0);
    let (ledger, coin) = vault_funded_ledger(&script, 1_000);
    assert_eq!(ledger.vault_activation_score(), VAULT_ACTIVATION_SCORE);
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&script.address()), 1_000);
    assert!(utxo.contains(&coin));
}

// =========================================================================
// CSV consensus rule — 4 tests
// =========================================================================

#[test]
fn vault_csv_sequence_not_final() {
    // BIP-112: a tx with sequence=10 spending a 2-block-old output is non-final.
    let alice = generate_key(1);
    let (mut ledger, coin) = funded_ledger(alice.address(), 1_000);

    mine_blocks(&mut ledger, 2, 1);
    let bob = generate_key(2).address();
    let spend = build_signed_with_lock(
        coin,
        &alice,
        vec![TxOutput::native(900, bob)],
        b"csv".to_vec(),
        0,
        10,
    );
    let err = ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 3, 0, &[spend])
        .unwrap_err();
    assert!(matches!(
        err,
        LedgerInsertError::State(LedgerError::SequenceNotFinal { .. })
    ));
}

#[test]
fn vault_csv_sequence_final_after_delay() {
    // The same tx after 10 blocks: age 10 >= sequence 10 → final.
    let alice = generate_key(1);
    let (mut ledger, coin) = funded_ledger(alice.address(), 1_000);

    mine_blocks(&mut ledger, 10, 1);
    let bob = generate_key(2).address();
    let spend = build_signed_with_lock(
        coin,
        &alice,
        vec![TxOutput::native(900, bob)],
        b"csv".to_vec(),
        0,
        10,
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 11, 0, &[spend])
        .unwrap();
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
}

#[test]
fn vault_csv_sequence_zero_always_final() {
    // sequence=0 means final: no relative constraint, spendable immediately.
    let alice = generate_key(1);
    let (mut ledger, coin) = funded_ledger(alice.address(), 1_000);

    let bob = generate_key(2).address();
    let spend = build_signed_with_lock(
        coin,
        &alice,
        vec![TxOutput::native(900, bob)],
        b"csv-zero".to_vec(),
        0,
        0,
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 1, 0, &[spend])
        .unwrap();
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&bob), 900);
}

#[test]
fn vault_csv_unknown_age() {
    // An output decoded from a pre-v6 checkpoint has no creation height; a
    // relative-locktime spend of it fails closed with UnknownOutputAge.
    let owner = generate_key(1);
    let op = OutPoint::new(TxId::from_bytes([1u8; 32]), 0);
    let mut set = UtxoSet::new();
    set.insert(op, TxOutput::native(100, owner.address()), 5);

    let bytes = set.encode();
    let mut slice = &bytes[..];
    let v5_set = UtxoSet::decode(&mut slice, 5).unwrap();
    assert_eq!(v5_set.created_at_of(&op), None, "pre-v6 ages are unknown");

    let tx = Transaction::new_with_lock(
        vec![TxInput {
            outpoint: op,
            witness: Vec::new(),
        }],
        vec![TxOutput::native(90, owner.address())],
        b"csv-unknown".to_vec(),
        0,
        10,
    );
    let err = apply_block(&mut v5_set.clone(), &[tx], 0).unwrap_err();
    assert!(matches!(err, LedgerError::UnknownOutputAge { .. }));
}

// =========================================================================
// Parallel-DAG — 2 tests
// =========================================================================

#[test]
fn vault_parallel_double_claim() {
    // Two parallel blocks both claim the SAME vault coin. Each is valid in its
    // own view (the coin is unspent in both) → both admitted; the selected
    // tip's state resolves the conflict deterministically by linearization.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 0, 0); // no lock
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);
    let genesis_id = ledger.dag().selected_tip();

    let alice = generate_key(3).address();
    let bob = generate_key(4).address();

    let claim_a = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, alice)],
        b"a".to_vec(),
    );
    let id_a = ledger
        .insert(vec![genesis_id], 1, 1, 0, &[claim_a])
        .unwrap();

    let claim_b = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"b".to_vec(),
    );
    let id_b = ledger
        .insert(vec![genesis_id], 1, 1, 0, &[claim_b])
        .unwrap();

    // Both are valid in their own view → both admitted.
    assert!(ledger.dag().contains(&id_a));
    assert!(ledger.dag().contains(&id_b));

    // The selected tip's state applies only one of the two spends.
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&alice) + utxo.balance(&bob), 900);
}

#[test]
fn vault_parallel_claim_vs_recover() {
    // Parallel claim (after lock) vs recover (before lock): only the valid one
    // applies. The lock is relative_delay=10, absolute_time=0; the claim block
    // is at height 11 (age 11 >= 10 ✓), the recover block at height 1 (age 1
    // < 10, lock not expired ✓). Both are valid in their own view.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 0);
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Mine 10 blocks so the claim is valid at height 11.
    let tip10 = mine_blocks(&mut ledger, 10, 1);

    let alice = generate_key(3).address();
    let bob = generate_key(4).address();

    // Claim block at height 11 on the height-10 tip.
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, alice)],
        b"claim".to_vec(),
    );
    let id_claim = ledger.insert(vec![tip10], 1, 11, 0, &[claim]).unwrap();

    // Recover block at height 1 on genesis (parallel to the whole chain).
    let recover = build_vault_recover(
        coin,
        &script,
        &owner,
        vec![TxOutput::native(900, bob)],
        b"recover".to_vec(),
    );
    let id_recover = ledger
        .insert(vec![ledger.genesis()], 1, 1, 0, &[recover])
        .unwrap();

    // Both are valid in their own view → both admitted.
    assert!(ledger.dag().contains(&id_claim));
    assert!(ledger.dag().contains(&id_recover));

    // The selected tip's state applies only one of the two spends.
    let utxo = ledger.state(&ledger.dag().selected_tip()).unwrap();
    assert_eq!(utxo.balance(&alice) + utxo.balance(&bob), 900);
}

// =========================================================================
// Checkpoint / snapshot — 2 tests
// =========================================================================

#[test]
fn vault_checkpoint_roundtrip_preserves_created_at() {
    // A vault funded at genesis (created_at=0) survives a checkpoint roundtrip
    // with its creation height intact: the relative delay is still enforced
    // after restore, and a claim that would be valid only with the correct age
    // succeeds.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 0); // pure CSV
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(1_000, script.address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let mut ledger = Ledger::with_finality(K, SCHEDULE, &[coinbase], 2).expect("valid genesis");

    // Push the tip past finality depth so finality activates (checkpoint requires it).
    let mut tip = ledger.dag().selected_tip();
    for i in 0..5 {
        let cb = Transaction::coinbase(
            vec![TxOutput::native(1_000, generate_key(10).address())],
            format!("cb{i}").into_bytes(),
        );
        tip = ledger.insert(vec![tip], 1, 0, 0, &[cb]).unwrap();
    }
    assert!(ledger.finality_score() > 0, "finality should be active");

    // Write checkpoint (v6: per-output creation heights).
    let buf = ledger.write_checkpoint().unwrap();

    // Read checkpoint into a new ledger.
    let mut restored = Ledger::read_checkpoint(&buf).unwrap();

    let restored_utxo = restored.state(&restored.dag().selected_tip()).unwrap();
    assert_eq!(restored_utxo.balance(&script.address()), 1_000);
    assert_eq!(restored.vault_activation_score(), VAULT_ACTIVATION_SCORE);

    // The vault output's creation height (0) survived: after 10 more blocks a
    // claim succeeds (age 11 >= 10). If the height had been lost (u64::MAX),
    // the age would compute to 0 and the claim would be rejected.
    let tip = mine_blocks(&mut restored, 10, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"post-restore".to_vec(),
    );
    restored.insert(vec![tip], 1, 11, 0, &[claim]).unwrap();
    let final_utxo = restored.state(&restored.dag().selected_tip()).unwrap();
    assert_eq!(final_utxo.balance(&bob), 900);
}

#[test]
fn vault_snapshot_roundtrip() {
    // A claimed vault survives a snapshot roundtrip: replay recomputes the
    // creation heights, so the restored ledger is identical.
    let beneficiary = generate_key(1);
    let owner = generate_key(2);
    let script = make_vault(&beneficiary, &owner, 10, 0); // pure CSV
    let (mut ledger, coin) = vault_funded_ledger(&script, 1_000);

    // Mine the delay, then claim before snapshot.
    mine_blocks(&mut ledger, 10, 1);
    let bob = generate_key(3).address();
    let claim = build_vault_claim(
        coin,
        &script,
        &beneficiary,
        vec![TxOutput::native(900, bob)],
        b"pre-snapshot".to_vec(),
    );
    ledger
        .insert(vec![ledger.dag().selected_tip()], 1, 11, 0, &[claim])
        .unwrap();

    let buf = ledger.write_snapshot();
    let restored = Ledger::read_snapshot(&buf).unwrap();

    let restored_utxo = restored.state(&restored.dag().selected_tip()).unwrap();
    assert_eq!(restored_utxo.balance(&bob), 900);
    assert_eq!(restored_utxo.balance(&script.address()), 0);
    assert_eq!(restored.vault_activation_score(), VAULT_ACTIVATION_SCORE);
}
