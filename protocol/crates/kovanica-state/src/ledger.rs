//! Applying transactions to the UTXO set — the ledger's state-transition rules.
//!
//! Two layers live here:
//!
//! * [`apply_block`] — the strict, atomic state transition for one block's
//!   worth of transactions against a [`UtxoSet`]. It validates every spend
//!   (existence, no double-spend within the block, signature, value
//!   conservation) and the coinbase (issuance ≤ subsidy + fees), then commits.
//!   On *any* error the UTXO set is left untouched.
//! * [`apply_dag`] — the bridge to consensus. It walks
//!   `kovanica_dag::Dag::linearize()` (the deterministic GHOSTDAG total order),
//!   decodes each block's payload into transactions, and applies them in that
//!   order. This is what makes the ledger a *DAG* ledger: parallel blocks are
//!   ordered by GHOSTDAG, and a conflicting spend loses simply because the block
//!   that wins the linearization spent the output first.
//!
//! ## Rules, precisely
//!
//! For a non-coinbase transaction against the current UTXO set:
//! 1. it has at least one input and one output;
//! 2. no outpoint is spent twice within the same transaction;
//! 3. every spent outpoint is currently unspent (exists in the set);
//! 4. every input's signature verifies against the spent output's owner over the
//!    transaction's [`sighash`](crate::tx::Transaction::sighash);
//! 5. every output value is non-zero;
//! 6. outputs do not exceed inputs; the difference is the fee.
//!
//! A block may begin with a single coinbase (input-less) transaction. Regular
//! transactions are applied first, in list order, accumulating fees; then the
//! coinbase's outputs are validated to sum to **at most** `subsidy + fees` and
//! applied last. Because the coinbase is applied last, its outputs are not
//! spendable within the same block (a light-touch maturity rule).
//!
//! ## Undo-log / delta semantics
//!
//! The incremental [`Ledger`] does not store a full UTXO set per block. It keeps
//! a **single materialised state at the selected tip** plus compact per-block
//! **undo deltas** along the selected-parent tree:
//!
//! * `deltas[&B]` records the net UTXO change from `selected_parent(B)`'s view
//!   to `B`'s own view: outputs created by `B` (or its mergeset in `B`'s view)
//!   and outputs spent in that transition.
//!
//! Reconstructing a non-final block's view walks its selected-parent chain down
//! to the deepest block whose selected parent is final (or genesis), applying
//! each delta in order. Because final blocks' deltas are **folded into their
//! children** before they are dropped, a child's delta is always relative to the
//! deepest non-final ancestor in its chain. Folding is compositional: applying
//! the folded delta reproduces the same state as applying the original sequence.
//!
//! Pruning is triggered automatically after every block insertion. It is
//! **idempotent**: once the current finality threshold has been processed, a
//! second call at the same threshold removes no additional deltas and changes no
//! reconstructable state. The threshold only advances when the selected tip's
//! blue score grows, so a folded delta is never lost while it is still needed.
//!
//! ## Finality
//!
//! A `Ledger` built with [`Ledger::with_finality`] treats blocks more than
//! `finality_depth` blue score below the selected tip as **final**: their
//! per-block state is pruned and new blocks may not build on them. Re-orgs above
//! the finality point are implicit — [`Ledger::ledger_state`] follows the current
//! selected tip — and pruning affects only the per-block *state*, not the DAG
//! itself, which remains append-only.

use std::collections::{HashMap, HashSet};

use kovanica_dag::{
    decode_snapshot, AuthorityError, AuthoritySet, AuthorityUpdateTx, Block, BlockId, Dag,
    DagError, KParam, PoAConfig, SnapshotError,
};

use crate::htlc::HtlcScript;
use crate::keys::{verify, verify_pk, Address, KeyPair};
use crate::multisig::{verify_threshold_signatures, MultisigScript};
use crate::script_v2::ScriptV2;
use crate::vault::VaultScript;

/// Default blue-score threshold for RFC-001 multisig activation.
pub const MULTISIG_ACTIVATION_SCORE: u64 = 0;

/// Default blue-score threshold for RFC-002 native token activation.
pub const NATIVE_TOKEN_ACTIVATION_SCORE: u64 = 0;

/// Default blue-score threshold for RFC-003 stealth address activation.
pub const STEALTH_ACTIVATION_SCORE: u64 = 0;

/// Default blue-score threshold for RFC-003 script v2 activation.
pub const SCRIPT_V2_ACTIVATION_SCORE: u64 = 0;

/// Default blue-score threshold for RFC-004 HTLC activation.
pub const HTLC_ACTIVATION_SCORE: u64 = 0;

/// Default blue-score threshold for RFC-005 vault activation.
pub const VAULT_ACTIVATION_SCORE: u64 = 0;

/// RFC-006 is active from genesis (blue score 0) on `kovanica-testnet`: the
/// smooth emission curve, the [`MAX_SUPPLY`] cap, the 100-block coinbase
/// maturity, and the 75%/25% fee burn are **unconditional** hard rules — they
/// are deliberately not gated by a blue-score activation knob.
///
/// Retained only as the documented activation marker. There is no pre-activation
/// economics to fall back to (the ledger holds a single emission schedule), so do
/// **not** branch on it.
pub const TOKENOMICS_ACTIVATION_SCORE: u64 = 0;

/// KVP-107: default blue-score threshold for mint price enforcement.
/// When blue_score > this value, mint_price_per_unit is enforced.
pub const MINT_PRICE_ACTIVATION_SCORE: u64 = 0;

/// KVP-107: default blue-score threshold for asset logo/metadata.
/// When blue_score > this value, logo_uri and metadata_uri are validated.
pub const ASSET_LOGO_ACTIVATION_SCORE: u64 = 0;

/// KVP-107: base fee to register a new asset (1000 KVNC = 100_000_000_000 atoms).
pub const ASSET_CREATION_FEE: u64 = 1000 * ATOM;

/// KVP-107: minimum mint price per unit (1 atom KVNC per base unit).
pub const MIN_MINT_PRICE: u64 = 1;

/// KVP-107: maximum mint price per unit (1 KVNC per base unit = 100_000_000 atoms).
pub const MAX_MINT_PRICE: u64 = ATOM;

/// RFC-006 emission schedule for block subsidy.
///
/// Smooth geometric decay: `s(era) = floor(s(era-1) * 3/4)` with
/// `era = height / era_length`. Genesis (height 0) gets the full subsidy.
/// Eras >= 256 return 0.
///
/// Type name `HalvingSchedule` retained for API stability; decay is geometric
/// (alpha = 3/4), not binary halving.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HalvingSchedule {
    /// Subsidy at genesis (height 0), in atoms.
    pub genesis_subsidy: u64,
    /// Number of blocks per emission era (`E` in RFC-006).
    pub halving_era: u64,
}

impl HalvingSchedule {
    /// Create a new emission schedule.
    pub const fn new(genesis_subsidy: u64, halving_era: u64) -> Self {
        Self {
            genesis_subsidy,
            halving_era,
        }
    }

    /// RFC-006 schedule: s0 = 10 KVNC, E = 2_000_000.
    pub const fn rfc006() -> Self {
        Self {
            genesis_subsidy: RFC006_GENESIS_SUBSIDY,
            halving_era: RFC006_ERA_LENGTH,
        }
    }

    /// Subsidy at `height` (height 0 = genesis). Geometric alpha = 3/4 per era.
    pub fn subsidy_at(&self, height: u64) -> u64 {
        if self.halving_era == 0 {
            return 0;
        }
        let era = height / self.halving_era;
        if era >= 256 {
            return 0;
        }
        let mut s = self.genesis_subsidy;
        for _ in 0..era {
            s = s.saturating_mul(3) / 4;
            if s == 0 {
                return 0;
            }
        }
        s
    }
}

/// Default era length; prefer [`HalvingSchedule::rfc006`] for production.
pub const DEFAULT_HALVING_ERA: u64 = RFC006_ERA_LENGTH;

/// RFC-006: 1 KVNC = 10^8 atoms.
pub const ATOM: u64 = 100_000_000;
/// RFC-006 genesis subsidy: 10 KVNC per block.
pub const RFC006_GENESIS_SUBSIDY: u64 = 10 * ATOM;
/// RFC-006 era length: 2_050_000 blocks.
///
/// **CONSENSUS-CRITICAL.** The curve emission is *derived*, never stored:
///
/// ```text
/// curve = RFC006_GENESIS_SUBSIDY x RFC006_ERA_LENGTH x 1/(1 - alpha)
///       = 10 KVNC x 2_050_000 x 4
///       = 82_000_000 KVNC   (alpha = 3/4, so 1/(1-alpha) = 4)
/// ```
///
/// Raised from 2_000_000 to 2_050_000 on 2026-09-29 to take the curve from 80M
/// to 82M as treasury came down from 10 x 1M to 8 x 1M. The era length is the
/// input moved rather than the genesis subsidy or the decay ratio, because
/// those two are the most widely-quoted numbers in the RFC and in operator
/// docs, and `s0` additionally feeds the RFC-006 fee floor
/// (`subsidy / 500_000`) and the `/api/head` subsidy field.
///
/// Total decay horizon is unchanged in *shape* — 256 eras — but stretches from
/// 512_000_000 to 524_800_000 blocks.
///
/// Note the realised total is fractionally **below** 82M: `subsidy_at` floors
/// each era to whole atoms and every era at or beyond 256 pays zero. See
/// `rfc006_supply_decomposition` for the exact figure.
pub const RFC006_ERA_LENGTH: u64 = 2_050_000;
/// RFC-006 hard cap: 90.2M KVNC.
pub const MAX_SUPPLY: u64 = 90_200_000 * ATOM;
/// RFC-006 founder premine: 0.2M KVNC.
pub const RFC006_PREMINE: u64 = 200_000 * ATOM;
/// RFC-006 per-tranche treasury: 1M KVNC.
pub const RFC006_TREASURY_TRANCHE: u64 = 1_000_000 * ATOM;
/// RFC-006 number of treasury vault tranches: **8** (was 10).
///
/// Reduced from 10 to 8 on 2026-09-29. The 2M KVNC difference **was**
/// reallocated to the emission curve, which was raised from 80M to 82M by
/// moving [`RFC006_ERA_LENGTH`] from 2_000_000 to 2_050_000. See
/// `rfc006_supply_decomposition` for the exact arithmetic.
///
/// Why the era length and not another derivation input? The curve is derived
/// as `s0 x era x 1/(1-alpha)`. Moving `s0` to 10.25 KVNC would also have moved
/// the genesis subsidy and the fee floor; moving alpha to 0.756097... is
/// irrational. The era length is the input with the fewest dependencies.
///
/// **CONSENSUS-CRITICAL.** This constant sets the number of vault outputs in the
/// genesis coinbase (see [`rfc006_genesis_coinbase`]), so changing it changes
/// the genesis hash. Mainnet is dormant and unaffected; an already-running
/// testnet would require a chain reset to adopt it.
pub const RFC006_TREASURY_TRANCHES: u32 = 8;
/// RFC-006 treasury total: 8M KVNC. **Derived — do not hard-code.**
///
/// Derived as `TRANCHE * TRANCHES` so the two can never disagree. This was a
/// literal `10_000_000 * ATOM` with no consumer anywhere in the workspace, i.e.
/// a documentation-only constant that nothing kept honest: raising or lowering
/// [`RFC006_TREASURY_TRANCHES`] would have silently desynchronised it.
///
/// Resulting RFC-006 issuance: 82M curve + 0.2M premine + 8M treasury =
/// **90.2M** against a [`MAX_SUPPLY`] ceiling of 90.2M. The realised total sits
/// a few KVNC under that, because the curve is floored to whole atoms per era
/// and truncated at era 256. `MAX_SUPPLY` is a ceiling, not a target — the
/// ledger must never be topped up, and the cap must never be lowered, to close
/// that gap.
pub const RFC006_TREASURY_TOTAL: u64 = RFC006_TREASURY_TRANCHE * RFC006_TREASURY_TRANCHES as u64;
/// ~blocks/year at 1 block/s (vault absolute unlock spacing).
pub const BLOCKS_PER_YEAR: u32 = 31_536_000;
/// RFC-006 coinbase maturity.
pub const COINBASE_MATURITY: u64 = 100;
/// Fee producer share numerator (1/4); remainder burned.
pub const FEE_PRODUCER_NUM: u64 = 1;
pub const FEE_PRODUCER_DEN: u64 = 4;
/// Placeholder treasury key seed base (tranche k uses base + k).
///
/// TESTNET-ONLY: the placeholder keys are publicly derivable by design
/// (`KeyPair::from_u64(TREASURY_SEED_BASE + k)` — anyone can compute them).
/// Production MUST pass a real secret `treasury_seed` via key ceremony; never
/// use the placeholder keys for real funds.
const TREASURY_SEED_BASE: u32 = 0x7E45_0000;

/// RFC-006 supply metrics from [`Ledger::supply`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct SupplyMetrics {
    pub total: u64,
    pub circulating: u64,
    pub burned: u64,
    pub max_supply: u64,
}

use crate::tx::{
    decode_block_payload, encode_block_payload, AssetCreationParams, AssetId, AssetKind,
    AssetRegistryEntry, DecodeError, LogoScheme, LogoUri, MetadataScheme, MetadataUri, OutPoint,
    Transaction, TxId, TxOutput,
};
use crate::utxo::{UtxoEntry, UtxoSet};
use crate::validation::TxStructureValidator;

/// Why a transaction or block could not be applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LedgerError {
    /// A spent outpoint is not in the UTXO set (missing, already spent, or —
    /// for a same-block coinbase output — not yet mature).
    MissingInput(OutPoint),
    /// The same outpoint is spent twice within one transaction.
    DuplicateInput(OutPoint),
    /// A created output's outpoint already exists (id collision / replay).
    OutputAlreadyExists(OutPoint),
    /// An input's signature did not verify against the spent output's owner.
    BadSignature { tx: TxId, input: usize },
    /// A transaction's outputs exceed its inputs (it would mint value).
    ValueNotConserved { tx: TxId, inputs: u64, outputs: u64 },
    /// A value sum overflowed `u64`.
    ValueOverflow,
    /// A non-coinbase transaction had no inputs, or a coinbase had no outputs to
    /// carry any value — i.e. a structurally empty transaction where the model
    /// requires content.
    EmptyTransaction(TxId),
    /// An output has zero value.
    ZeroValueOutput(TxId),
    /// A coinbase (input-less) transaction appeared somewhere other than first.
    MisplacedCoinbase(TxId),
    /// The coinbase claims more than `subsidy + fee_share` allows.
    CoinbaseOverspend { claimed: u64, allowed: u64 },
    /// RFC-006: minting would exceed MAX_SUPPLY.
    SupplyCapExceeded {
        claimed: u64,
        native_minted: u64,
        max_supply: u64,
    },
    /// RFC-006: coinbase output spent before maturity.
    CoinbaseImmature {
        outpoint: OutPoint,
        creation_height: u64,
        maturity: u64,
        block_height: u64,
    },
    /// A block's payload could not be decoded into transactions.
    Payload(DecodeError),

    // Multisig & Witness Upgrade Variants
    /// Witness stack does not match address requirements (e.g. count != 1 for V0 or != 1+M for V1)
    InvalidWitnessCount {
        tx: TxId,
        input: usize,
        expected: usize,
        actual: usize,
    },
    /// Script hash does not match the P2SH address hash
    ScriptHashMismatch { tx: TxId, input: usize },
    /// Malformed Redeem Script (invalid M/N ratio, length mismatch, or M=0)
    InvalidRedeemScript {
        tx: TxId,
        input: usize,
        reason: &'static str,
    },
    /// Witness item has invalid signature length
    BadSignatureSize { tx: TxId, input: usize, len: usize },
    /// Duplicate signature found in witness stack
    DuplicateSignature { tx: TxId, input: usize },
    /// Multisig transaction submitted prior to consensus activation blue score
    PreActivationMultisig {
        tx: TxId,
        blue_score: u64,
        activation_score: u64,
    },

    // Native Token (RFC-002) Variants
    /// Transaction mixes multiple asset IDs in inputs/outputs without proper conservation
    AssetMismatch {
        tx: TxId,
        expected: Option<crate::tx::AssetId>,
        found: Option<crate::tx::AssetId>,
    },
    /// Asset value not conserved per asset ID (inputs != outputs for a given asset)
    AssetNotConserved {
        tx: TxId,
        asset_id: Option<crate::tx::AssetId>,
        inputs: u64,
        outputs: u64,
    },
    /// Native token transaction submitted prior to consensus activation blue score
    PreActivationNativeToken {
        tx: TxId,
        blue_score: u64,
        activation_score: u64,
    },
    /// Stealth address transaction submitted prior to consensus activation blue score
    PreActivationStealth {
        tx: TxId,
        blue_score: u64,
        activation_score: u64,
    },
    /// Script v2 transaction submitted prior to consensus activation blue score
    PreActivationScriptV2 {
        tx: TxId,
        blue_score: u64,
        activation_score: u64,
    },

    // HTLC (RFC-004) Variants
    /// HTLC transaction submitted prior to consensus activation blue score
    PreActivationHtlc {
        tx: TxId,
        blue_score: u64,
        activation_score: u64,
    },
    /// The HTLC redeem preimage does not hash to the committed preimage hash.
    HtlcPreimageMismatch { tx: TxId, input: usize },
    /// An HTLC refund was attempted before the chain reached the timeout height.
    HtlcTimeoutNotReached {
        tx: TxId,
        input: usize,
        height: u64,
        timeout: u32,
    },
    /// A transaction's `n_lock_time` exceeds the block's height, so it is
    /// non-final and cannot be mined (BIP-65/BIP-113).
    NonFinalTransaction {
        tx: TxId,
        n_lock_time: u32,
        height: u64,
    },

    // Vault (RFC-005) Variants
    /// Vault transaction submitted prior to consensus activation blue score
    PreActivationVault {
        tx: TxId,
        blue_score: u64,
        activation_score: u64,
    },
    /// A transaction input declares a non-final relative `sequence` (BIP-68/BIP-112
    /// CSV) but the UTXO it spends has not yet aged `sequence` blocks — it was
    /// created at `creation_height` and the spending block is `block_height`.
    NonFinalRelativeSequence {
        tx: TxId,
        outpoint: OutPoint,
        creation_height: u64,
        sequence: u32,
        block_height: u64,
    },
    /// A vault spend attempted before the template's absolute `unlock_height`
    /// (CLTV-style) was reached.
    VaultAbsoluteNotReached {
        tx: TxId,
        input: usize,
        required: u32,
        block_height: u64,
    },
    /// A vault spend attempted before the template's relative `csv` age had
    /// elapsed (`block_height >= creation_height + csv`).
    VaultRelativeNotReached {
        tx: TxId,
        input: usize,
        required: u32,
        creation_height: u64,
        block_height: u64,
    },

    // KVP-107: Mint Price Variants
    /// Insufficient KVNC fee paid for minting an asset with a mint price.
    InsufficientMintFee {
        tx: TxId,
        asset_id: AssetId,
        required: u64,
        paid: u64,
    },
    /// An asset's logo or metadata URI failed validation (size, scheme, or
    /// content-hash constraints) after the logo activation score was reached.
    InvalidAssetLogo {
        tx: TxId,
        asset_id: AssetId,
        field: &'static str,
    },
}

impl core::fmt::Display for LedgerError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            LedgerError::MissingInput(op) => write!(f, "missing/spent input {op:?}"),
            LedgerError::DuplicateInput(op) => write!(f, "duplicate input {op:?}"),
            LedgerError::OutputAlreadyExists(op) => write!(f, "output already exists {op:?}"),
            LedgerError::BadSignature { tx, input } => {
                write!(f, "bad signature on input {input} of {tx}")
            }
            LedgerError::ValueNotConserved {
                tx,
                inputs,
                outputs,
            } => write!(
                f,
                "value not conserved in {tx}: in {inputs} < out {outputs}"
            ),
            LedgerError::ValueOverflow => f.write_str("value sum overflowed"),
            LedgerError::EmptyTransaction(tx) => write!(f, "empty transaction {tx}"),
            LedgerError::ZeroValueOutput(tx) => write!(f, "zero-value output in {tx}"),
            LedgerError::MisplacedCoinbase(tx) => write!(f, "misplaced coinbase {tx}"),
            LedgerError::CoinbaseOverspend { claimed, allowed } => {
                write!(
                    f,
                    "coinbase overspend: claimed {claimed} > allowed {allowed}"
                )
            }
            LedgerError::SupplyCapExceeded {
                claimed,
                native_minted,
                max_supply,
            } => write!(
                f,
                "supply cap exceeded: claimed {claimed} + minted {native_minted} > max {max_supply}"
            ),
            LedgerError::CoinbaseImmature {
                outpoint,
                creation_height,
                maturity,
                block_height,
            } => write!(
                f,
                "coinbase immature: {outpoint:?} created at {creation_height}, maturity {maturity}, block {block_height}"
            ),
            LedgerError::Payload(e) => write!(f, "payload decode: {e}"),
            LedgerError::InvalidWitnessCount {
                tx,
                input,
                expected,
                actual,
            } => write!(
                f,
                "invalid witness count on input {input} of {tx}: expected {expected}, got {actual}"
            ),
            LedgerError::ScriptHashMismatch { tx, input } => {
                write!(f, "script hash mismatch on input {input} of {tx}")
            }
            LedgerError::InvalidRedeemScript { tx, input, reason } => {
                write!(f, "invalid redeem script on input {input} of {tx}: {reason}")
            }
            LedgerError::BadSignatureSize { tx, input, len } => {
                write!(
                    f,
                    "bad signature size {len} (expected 64) on input {input} of {tx}"
                )
            }
            LedgerError::DuplicateSignature { tx, input } => {
                write!(f, "duplicate signature in witness on input {input} of {tx}")
            }
            LedgerError::PreActivationMultisig {
                tx,
                blue_score,
                activation_score,
            } => write!(
                f,
                "multisig tx {tx} rejected before activation: blue score {blue_score} <= activation {activation_score}"
            ),
            LedgerError::AssetMismatch {
                tx,
                expected,
                found,
            } => write!(
                f,
                "asset mismatch in {tx}: expected {:?}, found {:?}",
                expected, found
            ),
            LedgerError::AssetNotConserved {
                tx,
                asset_id,
                inputs,
                outputs,
            } => write!(
                f,
                "asset {:?} not conserved in {tx}: in {inputs} != out {outputs}",
                asset_id
            ),
            LedgerError::PreActivationNativeToken {
                tx,
                blue_score,
                activation_score,
            } => write!(
                f,
                "native token tx {tx} rejected before activation: blue score {blue_score} <= activation {activation_score}"
            ),
            LedgerError::PreActivationStealth {
                tx,
                blue_score,
                activation_score,
            } => write!(
                f,
                "stealth tx {tx} rejected before activation: blue score {blue_score} <= activation {activation_score}"
            ),
            LedgerError::PreActivationScriptV2 {
                tx,
                blue_score,
                activation_score,
            } => write!(
                f,
                "script v2 tx {tx} rejected before activation: blue score {blue_score} <= activation {activation_score}"
            ),
            LedgerError::PreActivationHtlc {
                tx,
                blue_score,
                activation_score,
            } => write!(
                f,
                "htlc tx {tx} rejected before activation: blue score {blue_score} <= activation {activation_score}"
            ),
            LedgerError::HtlcPreimageMismatch { tx, input } => write!(
                f,
                "htlc preimage mismatch on input {input} of {tx}"
            ),
            LedgerError::HtlcTimeoutNotReached {
                tx,
                input,
                height,
                timeout,
            } => write!(
                f,
                "htlc refund on input {input} of {tx} before timeout: height {height} < timeout {timeout}"
            ),
            LedgerError::NonFinalTransaction {
                tx,
                n_lock_time,
                height,
            } => write!(
                f,
                "transaction {tx} is non-final: n_lock_time {n_lock_time} > block height {height}"
            ),
            LedgerError::PreActivationVault {
                tx,
                blue_score,
                activation_score,
            } => write!(
                f,
                "vault tx {tx} rejected before activation: blue score {blue_score} <= activation {activation_score}"
            ),
            LedgerError::NonFinalRelativeSequence {
                tx,
                outpoint,
                creation_height,
                sequence,
                block_height,
            } => write!(
                f,
                "transaction {tx} is non-final: input {outpoint:?} (created at height {creation_height}) has relative sequence {sequence}, but block height {block_height} < {creation_height} + {sequence}"
            ),
            LedgerError::VaultAbsoluteNotReached {
                tx,
                input,
                required,
                block_height,
            } => write!(
                f,
                "vault input {input} of {tx} locked: block height {block_height} < unlock height {required}"
            ),
            LedgerError::VaultRelativeNotReached {
                tx,
                input,
                required,
                creation_height,
                block_height,
            } => write!(
                f,
                "vault input {input} of {tx} locked: block height {block_height} < creation height {creation_height} + csv {required}"
            ),
            LedgerError::InsufficientMintFee {
                tx,
                asset_id,
                required,
                paid,
            } => write!(
                f,
                "insufficient mint fee for asset {asset_id} in {tx}: required {required} atoms KVNC, paid {paid}"
            ),
            LedgerError::InvalidAssetLogo {
                tx,
                asset_id,
                field,
            } => write!(
                f,
                "invalid {field} for asset {asset_id} in {tx}"
            ),
        }
    }
}

impl std::error::Error for LedgerError {}

/// What a successfully applied block moved: total fees collected from its
/// transactions and total value minted by its coinbase.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BlockSummary {
    /// Sum of `inputs − outputs` across the block's non-coinbase transactions.
    pub fees: u64,
    /// Total value claimed by the block's coinbase (0 if none).
    pub minted: u64,
}

/// Apply one block's transactions to `utxo`, atomically.
///
/// `txs` is the block's transaction list; if the first has no inputs it is the
/// coinbase. `subsidy` is the issuance allowance for this block. Returns a
/// [`BlockSummary`] on success. On any error, `utxo` is left exactly as it was.
pub fn apply_block(
    utxo: &mut UtxoSet,
    txs: &[Transaction],
    subsidy: u64,
) -> Result<BlockSummary, LedgerError> {
    let mut asset_registry = HashMap::new();
    apply_block_inner(
        utxo,
        &mut asset_registry,
        txs,
        subsidy,
        0,        // cumulative_minted: not tracked in simple apply_block
        0,        // height: not used for subsidy in simple apply_block
        u64::MAX, // blue_score: max to disable activation gating
        MULTISIG_ACTIVATION_SCORE,
        NATIVE_TOKEN_ACTIVATION_SCORE,
        STEALTH_ACTIVATION_SCORE,
        SCRIPT_V2_ACTIVATION_SCORE,
        HTLC_ACTIVATION_SCORE,
        VAULT_ACTIVATION_SCORE,
        MINT_PRICE_ACTIVATION_SCORE,
        ASSET_LOGO_ACTIVATION_SCORE,
    )
}

/// Apply one block's transactions to `utxo`, atomically, at an explicit
/// `height`.
///
/// Same transition as [`apply_block`], but the block's height is supplied by
/// the caller instead of defaulting to `0`. Height matters for two rules:
/// coinbase outputs are stamped with it and cannot be spent until
/// `height + COINBASE_MATURITY` (RFC-006), and it selects the era on the
/// emission curve. Use this when replaying a chain whose heights are known
/// (e.g. an independent reference model); for a single isolated block with no
/// coinbase, [`apply_block`] is enough.
pub fn apply_block_at_height(
    utxo: &mut UtxoSet,
    txs: &[Transaction],
    subsidy: u64,
    height: u64,
) -> Result<BlockSummary, LedgerError> {
    let mut asset_registry = HashMap::new();
    apply_block_inner(
        utxo,
        &mut asset_registry,
        txs,
        subsidy,
        0, // cumulative_minted: not tracked in this simple entry point
        height,
        u64::MAX, // blue_score: max to disable activation gating
        MULTISIG_ACTIVATION_SCORE,
        NATIVE_TOKEN_ACTIVATION_SCORE,
        STEALTH_ACTIVATION_SCORE,
        SCRIPT_V2_ACTIVATION_SCORE,
        HTLC_ACTIVATION_SCORE,
        VAULT_ACTIVATION_SCORE,
        MINT_PRICE_ACTIVATION_SCORE,
        ASSET_LOGO_ACTIVATION_SCORE,
    )
}

/// Shared implementation behind [`apply_block`] and the incremental
/// [`Ledger::apply_new_block`] path.
/// The activation scores are explicit parameters so both entry points pass
/// their own policy; grouping them would churn every call site for no gain.
#[allow(clippy::too_many_arguments)]
fn apply_block_inner(
    utxo: &mut UtxoSet,
    asset_registry: &mut HashMap<AssetId, AssetRegistryEntry>,
    txs: &[Transaction],
    subsidy: u64,
    cumulative_minted: u64,
    height: u64,
    blue_score: u64,
    multisig_activation_score: u64,
    native_token_activation_score: u64,
    stealth_activation_score: u64,
    script_v2_activation_score: u64,
    htlc_activation_score: u64,
    vault_activation_score: u64,
    mint_price_activation_score: u64,
    asset_logo_activation_score: u64,
) -> Result<BlockSummary, LedgerError> {
    // Stage all changes on a copy; only commit if the whole block validates, so
    // a rejected block has no effect (atomicity).
    let mut staging = utxo.clone();

    let mut coinbase: Option<&Transaction> = None;
    let mut total_fees: u64 = 0;

    for (i, tx) in txs.iter().enumerate() {
        if tx.is_coinbase() {
            if i != 0 {
                return Err(LedgerError::MisplacedCoinbase(tx.id()));
            }
            coinbase = Some(tx);
            continue; // applied last, after fees are known
        }
        let fee = apply_regular(
            &mut staging,
            asset_registry,
            tx,
            height,
            blue_score,
            multisig_activation_score,
            native_token_activation_score,
            stealth_activation_score,
            script_v2_activation_score,
            htlc_activation_score,
            vault_activation_score,
            mint_price_activation_score,
            asset_logo_activation_score,
        )?;
        total_fees = total_fees
            .checked_add(fee)
            .ok_or(LedgerError::ValueOverflow)?;
    }

    // RFC-006: producer claims subsidy + fees/4; 75% of fees burned.
    let fee_share = total_fees / FEE_PRODUCER_DEN * FEE_PRODUCER_NUM;
    let allowed = subsidy
        .checked_add(fee_share)
        .ok_or(LedgerError::ValueOverflow)?;
    let (minted, creation_fee) = match coinbase {
        Some(cb) => apply_coinbase(
            &mut staging,
            asset_registry,
            cb,
            allowed,
            cumulative_minted,
            height,
            blue_score,
            multisig_activation_score,
            native_token_activation_score,
            stealth_activation_score,
            script_v2_activation_score,
            htlc_activation_score,
        )?,
        None => (0, 0),
    };
    // KVP-107: creation fee is handled like regular fees — 75% burned, 25% to producer
    let total_fees_with_creation = total_fees
        .checked_add(creation_fee)
        .ok_or(LedgerError::ValueOverflow)?;

    *utxo = staging;
    Ok(BlockSummary {
        fees: total_fees_with_creation,
        minted,
    })
}

/// Validate and apply a regular (non-coinbase) transaction, returning its fee.
#[allow(clippy::too_many_arguments)] // consensus-critical; argument count is intentional
fn apply_regular(
    staging: &mut UtxoSet,
    asset_registry: &HashMap<AssetId, AssetRegistryEntry>,
    tx: &Transaction,
    height: u64,
    blue_score: u64,
    multisig_activation_score: u64,
    native_token_activation_score: u64,
    stealth_activation_score: u64,
    script_v2_activation_score: u64,
    htlc_activation_score: u64,
    vault_activation_score: u64,
    mint_price_activation_score: u64,
    // KVP-107: logo_uri/metadata_uri validation is enforced when the activation
    // score is reached. The rule: when `blue_score > asset_logo_activation_score`,
    // any logo_uri or metadata_uri on a registry entry must satisfy the size and
    // scheme constraints defined by `LogoUri::new` / `MetadataUri::new`.
    asset_logo_activation_score: u64,
) -> Result<u64, LedgerError> {
    if tx.inputs().is_empty() || tx.outputs().is_empty() {
        return Err(LedgerError::EmptyTransaction(tx.id()));
    }

    // BIP-65/BIP-113 (Bitcoin's absolute locktime semantics): a transaction
    // whose `n_lock_time` exceeds the block's height is non-final and cannot be
    // mined. Combined with script v2's CLTV check (`tx.n_lock_time >= v`), the
    // effective constraint is `block_height >= n_lock_time >= v` — which makes
    // CLTV *real*: before this rule, a spender could bypass any CLTV by
    // declaring `n_lock_time = 4_000_000_000`. `n_lock_time` defaults to 0 in
    // every constructor, so only lock-time-signed transactions are affected.
    if u64::from(tx.n_lock_time()) > height {
        return Err(LedgerError::NonFinalTransaction {
            tx: tx.id(),
            n_lock_time: tx.n_lock_time(),
            height,
        });
    }

    // Pre-activation gating on outputs:
    if blue_score <= multisig_activation_score {
        for output in tx.outputs() {
            if output.owner.is_p2sh() {
                return Err(LedgerError::PreActivationMultisig {
                    tx: tx.id(),
                    blue_score,
                    activation_score: multisig_activation_score,
                });
            }
        }
    }

    // Native token pre-activation gating on outputs:
    if blue_score <= native_token_activation_score {
        for output in tx.outputs() {
            if output.asset_id.is_some() {
                return Err(LedgerError::PreActivationNativeToken {
                    tx: tx.id(),
                    blue_score,
                    activation_score: native_token_activation_score,
                });
            }
        }
    }

    // RFC-003 stealth pre-activation gating on outputs:
    if blue_score <= stealth_activation_score {
        for output in tx.outputs() {
            if output.owner.is_stealth() {
                return Err(LedgerError::PreActivationStealth {
                    tx: tx.id(),
                    blue_score,
                    activation_score: stealth_activation_score,
                });
            }
        }
    }

    // RFC-003 script v2 pre-activation gating on outputs:
    if blue_score <= script_v2_activation_score {
        for output in tx.outputs() {
            if output.owner.is_script_v2() {
                return Err(LedgerError::PreActivationScriptV2 {
                    tx: tx.id(),
                    blue_score,
                    activation_score: script_v2_activation_score,
                });
            }
        }
    }

    // RFC-004 HTLC pre-activation gating on outputs:
    if blue_score <= htlc_activation_score {
        for output in tx.outputs() {
            if output.owner.is_htlc() {
                return Err(LedgerError::PreActivationHtlc {
                    tx: tx.id(),
                    blue_score,
                    activation_score: htlc_activation_score,
                });
            }
        }
    }

    // RFC-005 vault pre-activation gating on outputs:
    if blue_score <= vault_activation_score {
        for output in tx.outputs() {
            if output.owner.is_vault() {
                return Err(LedgerError::PreActivationVault {
                    tx: tx.id(),
                    blue_score,
                    activation_score: vault_activation_score,
                });
            }
        }
    }

    let sighash = tx.sighash();
    let mut seen: HashSet<OutPoint> = HashSet::with_capacity(tx.inputs().len());
    let mut sum_in: u64 = 0;
    for (i, input) in tx.inputs().iter().enumerate() {
        if !seen.insert(input.outpoint) {
            return Err(LedgerError::DuplicateInput(input.outpoint));
        }
        // Resolve the full UTXO entry: output + the linearized height at which
        // it entered the set (RFC-005 §3.2 — the relative-locktime clock).
        let prev_entry = staging
            .get_entry(&input.outpoint)
            .ok_or(LedgerError::MissingInput(input.outpoint))?;
        let prev = &prev_entry.output;

        // RFC-006 coinbase maturity.
        if prev_entry.is_coinbase && prev_entry.creation_height > 0 {
            let mature_at = prev_entry.creation_height.saturating_add(COINBASE_MATURITY);
            if height < mature_at {
                return Err(LedgerError::CoinbaseImmature {
                    outpoint: input.outpoint,
                    creation_height: prev_entry.creation_height,
                    maturity: COINBASE_MATURITY,
                    block_height: height,
                });
            }
        }

        // Pre-activation gating on spends:
        if blue_score <= multisig_activation_score
            && (prev.owner.is_p2sh() || input.witness.len() > 1)
        {
            return Err(LedgerError::PreActivationMultisig {
                tx: tx.id(),
                blue_score,
                activation_score: multisig_activation_score,
            });
        }

        // Native token pre-activation gating on spends:
        if blue_score <= native_token_activation_score && prev.asset_id.is_some() {
            return Err(LedgerError::PreActivationNativeToken {
                tx: tx.id(),
                blue_score,
                activation_score: native_token_activation_score,
            });
        }

        // RFC-003 stealth pre-activation gating on spends:
        if blue_score <= stealth_activation_score && prev.owner.is_stealth() {
            return Err(LedgerError::PreActivationStealth {
                tx: tx.id(),
                blue_score,
                activation_score: stealth_activation_score,
            });
        }

        // RFC-003 script v2 pre-activation gating on spends:
        if blue_score <= script_v2_activation_score && prev.owner.is_script_v2() {
            return Err(LedgerError::PreActivationScriptV2 {
                tx: tx.id(),
                blue_score,
                activation_score: script_v2_activation_score,
            });
        }

        // RFC-004 HTLC pre-activation gating on spends:
        if blue_score <= htlc_activation_score && prev.owner.is_htlc() {
            return Err(LedgerError::PreActivationHtlc {
                tx: tx.id(),
                blue_score,
                activation_score: htlc_activation_score,
            });
        }

        // RFC-005 vault pre-activation gating on spends:
        if blue_score <= vault_activation_score && prev.owner.is_vault() {
            return Err(LedgerError::PreActivationVault {
                tx: tx.id(),
                blue_score,
                activation_score: vault_activation_score,
            });
        }

        // RFC-005 relative locktime (BIP-68/BIP-112 CSV): a transaction whose
        // `sequence` is non-final delays this spend until the input's UTXO has
        // aged that many blocks (measured from its *creation height*, not the
        // current view). `sequence == 0`, `sequence == 0xFFFF_FFFF`, and the
        // BIP-68 disable-flag bit (`0x80000000`) all mean "final". This is a
        // ledger-level finality rule like the CLTV gate above — it applies from
        // height zero because every pre-upgrade transaction has `sequence = 0`
        // (immediately final) and a new transaction declaring a non-final
        // sequence is a deliberate opt-in to relative locking (RFC-005 §3).
        let seq = tx.sequence();
        if seq != 0 && seq != u32::MAX && (seq & 0x8000_0000) == 0 {
            let creation_height = prev_entry.creation_height;
            // Overflow can never legitimately pass, and must not be treated as
            // "reached" — pin it to u64::MAX so the spend stays locked.
            let required = creation_height.saturating_add(u64::from(seq));
            if height < required {
                return Err(LedgerError::NonFinalRelativeSequence {
                    tx: tx.id(),
                    outpoint: input.outpoint,
                    creation_height,
                    sequence: seq,
                    block_height: height,
                });
            }
        }

        // Branch on address version:
        if prev.owner.is_p2pk() {
            if input.witness.len() != 1 {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: 1,
                    actual: input.witness.len(),
                });
            }
            let sig_bytes = &input.witness[0];
            if sig_bytes.len() != 64 {
                return Err(LedgerError::BadSignatureSize {
                    tx: tx.id(),
                    input: i,
                    len: sig_bytes.len(),
                });
            }
            let mut sig_arr = [0u8; 64];
            sig_arr.copy_from_slice(sig_bytes);
            if !verify(&prev.owner, &sighash, &sig_arr) {
                return Err(LedgerError::BadSignature {
                    tx: tx.id(),
                    input: i,
                });
            }
        } else if prev.owner.is_p2sh() {
            if input.witness.is_empty() {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: 1,
                    actual: 0,
                });
            }
            let redeem_script_bytes = &input.witness[0];
            let script_hash = *blake3::hash(redeem_script_bytes).as_bytes();
            if script_hash != *prev.owner.payload() {
                return Err(LedgerError::ScriptHashMismatch {
                    tx: tx.id(),
                    input: i,
                });
            }
            let script = MultisigScript::parse(redeem_script_bytes).map_err(|reason| {
                LedgerError::InvalidRedeemScript {
                    tx: tx.id(),
                    input: i,
                    reason,
                }
            })?;
            let expected_witness_count = 1 + script.m as usize;
            if input.witness.len() != expected_witness_count {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: expected_witness_count,
                    actual: input.witness.len(),
                });
            }
            let signatures = &input.witness[1..];
            for sig in signatures {
                if sig.len() != 64 {
                    return Err(LedgerError::BadSignatureSize {
                        tx: tx.id(),
                        input: i,
                        len: sig.len(),
                    });
                }
            }
            verify_threshold_signatures(&script, signatures, &sighash).map_err(|err_str| {
                if err_str == "duplicate signature in witness" {
                    LedgerError::DuplicateSignature {
                        tx: tx.id(),
                        input: i,
                    }
                } else if err_str == "signature must be 64 bytes" {
                    LedgerError::BadSignatureSize {
                        tx: tx.id(),
                        input: i,
                        len: 0,
                    }
                } else {
                    LedgerError::BadSignature {
                        tx: tx.id(),
                        input: i,
                    }
                }
            })?;
        } else if prev.owner.is_script_v2() {
            // Pay-to-Script-V2 (RFC-003): witness[0] = script bytes; BLAKE3(script)
            // must match the owner's script hash; the script then executes against
            // the remaining witness elements with lock-time/sequence context.
            if input.witness.is_empty() {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: 1,
                    actual: 0,
                });
            }
            let script_bytes = &input.witness[0];
            let script_hash = *blake3::hash(script_bytes).as_bytes();
            if script_hash != *prev.owner.payload() {
                return Err(LedgerError::ScriptHashMismatch {
                    tx: tx.id(),
                    input: i,
                });
            }
            let script =
                ScriptV2::new(script_bytes).map_err(|_| LedgerError::InvalidRedeemScript {
                    tx: tx.id(),
                    input: i,
                    reason: "script v2 parse failed",
                })?;
            let ok = script
                .execute(
                    &sighash,
                    &input.witness[1..],
                    tx.n_lock_time(),
                    tx.sequence(),
                )
                .map_err(|_| LedgerError::BadSignature {
                    tx: tx.id(),
                    input: i,
                })?;
            if !ok {
                return Err(LedgerError::BadSignature {
                    tx: tx.id(),
                    input: i,
                });
            }
        } else if prev.owner.is_htlc() {
            // Pay-to-HTLC (RFC-004): witness[0] = template bytes; BLAKE3(template)
            // must match the owner's script hash; the template then authorises one
            // of two mutually-exclusive paths discriminated by witness length —
            // deterministic, no branch evaluation:
            //   len 3 → REDEEM (preimage + recipient signature) — BIP-199
            //   len 2 → REFUND (sender signature, only after the timeout height)
            if input.witness.is_empty() {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: 2,
                    actual: 0,
                });
            }
            let template_bytes = &input.witness[0];
            let script_hash = *blake3::hash(template_bytes).as_bytes();
            if script_hash != *prev.owner.payload() {
                return Err(LedgerError::ScriptHashMismatch {
                    tx: tx.id(),
                    input: i,
                });
            }
            let script = HtlcScript::parse(template_bytes).map_err(|e| {
                LedgerError::InvalidRedeemScript {
                    tx: tx.id(),
                    input: i,
                    reason: e.as_str(),
                }
            })?;
            match input.witness.len() {
                3 => {
                    // REDEEM: witness[1] = preimage (any length), witness[2] =
                    // recipient signature. No time constraint (BIP-199).
                    let sig_bytes = &input.witness[2];
                    if sig_bytes.len() != 64 {
                        return Err(LedgerError::BadSignatureSize {
                            tx: tx.id(),
                            input: i,
                            len: sig_bytes.len(),
                        });
                    }
                    let preimage = &input.witness[1];
                    if *blake3::hash(preimage).as_bytes() != *script.preimage_hash() {
                        return Err(LedgerError::HtlcPreimageMismatch {
                            tx: tx.id(),
                            input: i,
                        });
                    }
                    let mut sig_arr = [0u8; 64];
                    sig_arr.copy_from_slice(sig_bytes);
                    if !verify_pk(script.recipient_pk(), &sighash, &sig_arr) {
                        return Err(LedgerError::BadSignature {
                            tx: tx.id(),
                            input: i,
                        });
                    }
                }
                2 => {
                    // REFUND: witness[1] = sender signature, valid only once the
                    // chain height has reached the template's timeout.
                    let sig_bytes = &input.witness[1];
                    if sig_bytes.len() != 64 {
                        return Err(LedgerError::BadSignatureSize {
                            tx: tx.id(),
                            input: i,
                            len: sig_bytes.len(),
                        });
                    }
                    if height < u64::from(script.timeout()) {
                        return Err(LedgerError::HtlcTimeoutNotReached {
                            tx: tx.id(),
                            input: i,
                            height,
                            timeout: script.timeout(),
                        });
                    }
                    let mut sig_arr = [0u8; 64];
                    sig_arr.copy_from_slice(sig_bytes);
                    if !verify_pk(script.sender_pk(), &sighash, &sig_arr) {
                        return Err(LedgerError::BadSignature {
                            tx: tx.id(),
                            input: i,
                        });
                    }
                }
                n => {
                    return Err(LedgerError::InvalidWitnessCount {
                        tx: tx.id(),
                        input: i,
                        expected: 2,
                        actual: n,
                    });
                }
            }
        } else if prev.owner.is_vault() {
            // Pay-to-Vault (RFC-005): witness[0] = template bytes; BLAKE3(template)
            // must match the owner's script hash. Both time locks are required,
            // then the owner signs the sighash — all four checks, no OR:
            //  1. witness exactly [template, owner_sig]
            //  2. template parse strict + hash match
            //  3. absolute lock:  height >= unlock_height
            //  4. relative lock:  height >= creation_height + csv
            if input.witness.len() != 2 {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: 2,
                    actual: input.witness.len(),
                });
            }
            let template_bytes = &input.witness[0];
            let script_hash = *blake3::hash(template_bytes).as_bytes();
            if script_hash != *prev.owner.payload() {
                return Err(LedgerError::ScriptHashMismatch {
                    tx: tx.id(),
                    input: i,
                });
            }
            let script = VaultScript::parse(template_bytes).map_err(|e| {
                LedgerError::InvalidRedeemScript {
                    tx: tx.id(),
                    input: i,
                    reason: e.as_str(),
                }
            })?;
            if height < u64::from(script.unlock_height()) {
                return Err(LedgerError::VaultAbsoluteNotReached {
                    tx: tx.id(),
                    input: i,
                    required: script.unlock_height(),
                    block_height: height,
                });
            }
            // Overflow must not be treated as "reached" — pin to u64::MAX.
            let required = prev_entry
                .creation_height
                .saturating_add(u64::from(script.csv()));
            if height < required {
                return Err(LedgerError::VaultRelativeNotReached {
                    tx: tx.id(),
                    input: i,
                    required: script.csv(),
                    creation_height: prev_entry.creation_height,
                    block_height: height,
                });
            }
            let sig_bytes = &input.witness[1];
            if sig_bytes.len() != 64 {
                return Err(LedgerError::BadSignatureSize {
                    tx: tx.id(),
                    input: i,
                    len: sig_bytes.len(),
                });
            }
            let mut sig_arr = [0u8; 64];
            sig_arr.copy_from_slice(sig_bytes);
            if !verify_pk(script.owner_pk(), &sighash, &sig_arr) {
                return Err(LedgerError::BadSignature {
                    tx: tx.id(),
                    input: i,
                });
            }
        } else if prev.owner.is_stealth() {
            // Stealth address (RFC-003): witness is exactly one 64-byte signature
            // over the sighash, verified against the output's one-time pubkey P.
            if input.witness.len() != 1 {
                return Err(LedgerError::InvalidWitnessCount {
                    tx: tx.id(),
                    input: i,
                    expected: 1,
                    actual: input.witness.len(),
                });
            }
            let sig_bytes: [u8; 64] = input.witness[0].as_slice().try_into().map_err(|_| {
                LedgerError::BadSignatureSize {
                    tx: tx.id(),
                    input: i,
                    len: input.witness[0].len(),
                }
            })?;
            let stealth = prev.stealth_or_default();
            if !verify_pk(&stealth.p, &sighash, &sig_bytes) {
                return Err(LedgerError::BadSignature {
                    tx: tx.id(),
                    input: i,
                });
            }
        } else {
            return Err(LedgerError::BadSignature {
                tx: tx.id(),
                input: i,
            });
        }

        sum_in = sum_in
            .checked_add(prev.value)
            .ok_or(LedgerError::ValueOverflow)?;
    }

    // Per-asset conservation: group inputs and outputs by asset_id
    let mut asset_inputs: HashMap<Option<crate::tx::AssetId>, u64> = HashMap::new();
    let mut asset_outputs: HashMap<Option<crate::tx::AssetId>, u64> = HashMap::new();

    // Sum inputs by asset_id
    for input in tx.inputs() {
        let prev = staging
            .get(&input.outpoint)
            .ok_or(LedgerError::MissingInput(input.outpoint))?;
        let asset_id = prev.asset_id;
        let val = asset_inputs.entry(asset_id).or_insert(0);
        *val = val
            .checked_add(prev.value)
            .ok_or(LedgerError::ValueOverflow)?;
    }

    // Sum outputs by asset_id
    for output in tx.outputs() {
        if output.value == 0 {
            return Err(LedgerError::ZeroValueOutput(tx.id()));
        }
        let asset_id = output.asset_id;
        let val = asset_outputs.entry(asset_id).or_insert(0);
        *val = val
            .checked_add(output.value)
            .ok_or(LedgerError::ValueOverflow)?;
    }

    // Check conservation per asset
    for (asset_id, in_val) in &asset_inputs {
        let out_val = asset_outputs.get(asset_id).copied().unwrap_or(0);
        if out_val > *in_val {
            return Err(LedgerError::AssetNotConserved {
                tx: tx.id(),
                asset_id: *asset_id,
                inputs: *in_val,
                outputs: out_val,
            });
        }
    }
    // Also check for assets that appear only in outputs (minting)
    for (asset_id, out_val) in &asset_outputs {
        if !asset_inputs.contains_key(asset_id) && *out_val > 0 {
            return Err(LedgerError::AssetNotConserved {
                tx: tx.id(),
                asset_id: *asset_id,
                inputs: 0,
                outputs: *out_val,
            });
        }
    }

    // NFT-specific validation (KVP-106):
    // - For NonFungible assets, each output must have value == 1
    // - For NonFungible assets, cannot create multiple outputs of same asset_id in one tx
    for output in tx.outputs() {
        if let Some(asset_id) = output.asset_id {
            if asset_registry.contains_key(&asset_id) {
                let entry = asset_registry.get(&asset_id).unwrap();
                if entry.is_nft() {
                    // NFT output must have value == 1
                    if output.value != 1 {
                        return Err(LedgerError::AssetNotConserved {
                            tx: tx.id(),
                            asset_id: Some(asset_id),
                            inputs: 1,
                            outputs: output.value,
                        });
                    }
                }
            }
        }
    }

    // Check for multiple outputs of same NFT in one transaction
    let mut nft_output_counts: HashMap<AssetId, usize> = HashMap::new();
    for output in tx.outputs() {
        if let Some(asset_id) = output.asset_id {
            if asset_registry.contains_key(&asset_id) {
                let entry = asset_registry.get(&asset_id).unwrap();
                if entry.is_nft() {
                    *nft_output_counts.entry(asset_id).or_insert(0) += 1;
                }
            }
        }
    }
    for (asset_id, count) in nft_output_counts {
        if count > 1 {
            return Err(LedgerError::AssetNotConserved {
                tx: tx.id(),
                asset_id: Some(asset_id),
                inputs: 1,
                outputs: count as u64,
            });
        }
    }

    // Fee must be paid in native KVNC (asset_id = None)
    let native_in = asset_inputs.get(&None).copied().unwrap_or(0);
    let native_out = asset_outputs.get(&None).copied().unwrap_or(0);
    if native_out > native_in {
        return Err(LedgerError::AssetNotConserved {
            tx: tx.id(),
            asset_id: None,
            inputs: native_in,
            outputs: native_out,
        });
    }
    let fee = native_in - native_out;

    // KVP-107: Mint price enforcement
    // Check each asset where outputs > inputs (minting new supply)
    if blue_score > mint_price_activation_score {
        for (asset_id_opt, out_val) in &asset_outputs {
            // Skip native KVNC (asset_id = None)
            let Some(asset_id) = *asset_id_opt else {
                continue;
            };
            let in_val = asset_inputs.get(asset_id_opt).copied().unwrap_or(0);
            if *out_val > in_val {
                let minted_amount = out_val - in_val;
                if let Some(entry) = asset_registry.get(&asset_id) {
                    let mint_price = entry.mint_price_per_unit;
                    if mint_price > 0 {
                        // Validate mint price bounds
                        if !(MIN_MINT_PRICE..=MAX_MINT_PRICE).contains(&mint_price) {
                            return Err(LedgerError::InsufficientMintFee {
                                tx: tx.id(),
                                asset_id,
                                required: minted_amount.saturating_mul(mint_price),
                                paid: fee,
                            });
                        }
                        let required_fee = minted_amount
                            .checked_mul(mint_price)
                            .ok_or(LedgerError::ValueOverflow)?;
                        if fee < required_fee {
                            return Err(LedgerError::InsufficientMintFee {
                                tx: tx.id(),
                                asset_id,
                                required: required_fee,
                                paid: fee,
                            });
                        }
                    }
                }
            }
        }
    }

    // KVP-107: Asset logo/metadata enforcement
    // When the activation score is reached, validate logo_uri and metadata_uri
    // on any registry entry involved in this transaction. The rule mirrors the
    // mint-price enforcement shape: gate on blue_score, iterate asset outputs,
    // look up the registry entry, and validate the URI fields.
    if blue_score > asset_logo_activation_score {
        for asset_id_opt in asset_outputs.keys() {
            let Some(asset_id) = *asset_id_opt else {
                continue;
            };
            if let Some(entry) = asset_registry.get(&asset_id) {
                if let Some(logo_uri) = &entry.logo_uri {
                    if logo_uri.uri.len() > LogoUri::MAX_URI_LEN {
                        return Err(LedgerError::InvalidAssetLogo {
                            tx: tx.id(),
                            asset_id,
                            field: "logo_uri",
                        });
                    }
                    if logo_uri.scheme == LogoScheme::Data
                        && logo_uri.uri.len() > LogoUri::MAX_DATA_LEN * 4 / 3 + 32
                    {
                        return Err(LedgerError::InvalidAssetLogo {
                            tx: tx.id(),
                            asset_id,
                            field: "logo_uri",
                        });
                    }
                }
                if let Some(metadata_uri) = &entry.metadata_uri {
                    if metadata_uri.uri.len() > MetadataUri::MAX_URI_LEN {
                        return Err(LedgerError::InvalidAssetLogo {
                            tx: tx.id(),
                            asset_id,
                            field: "metadata_uri",
                        });
                    }
                }
            }
        }
    }

    // Validation passed; mutate the staging set. (Any error above returned
    // before this point, so partial mutation cannot leak — and `apply_block`
    // discards `staging` unless the whole block succeeds.)
    let txid = tx.id();
    for input in tx.inputs() {
        staging.remove(&input.outpoint);
    }
    // New outputs are born at the applying block's height (RFC-005 §3.2) —
    // this is the `creation_height` CSV measures relative age against.
    add_outputs(staging, txid, tx, height, false)?;

    Ok(fee)
}

/// Validate and apply a coinbase transaction, returning the value minted and the creation fee paid.
#[allow(clippy::too_many_arguments)] // consensus-critical; argument count is intentional
fn apply_coinbase(
    staging: &mut UtxoSet,
    asset_registry: &HashMap<AssetId, AssetRegistryEntry>,
    cb: &Transaction,
    allowed: u64,
    cumulative_minted: u64,
    height: u64,
    blue_score: u64,
    activation_score: u64,
    _native_token_activation_score: u64,
    _stealth_activation_score: u64,
    _script_v2_activation_score: u64,
    _htlc_activation_score: u64,
) -> Result<(u64, u64), LedgerError> {
    if blue_score <= activation_score {
        for output in cb.outputs() {
            if output.owner.is_p2sh() {
                return Err(LedgerError::PreActivationMultisig {
                    tx: cb.id(),
                    blue_score,
                    activation_score,
                });
            }
        }
    }
    // Coinbase can mint any asset (for initial distribution). Regular transactions
    // must conserve assets (no minting) - enforced in apply_regular.
    // Native token activation gating does NOT apply to coinbase - it's for initial distribution.
    // Subsidy limit applies only to native KVNC outputs.
    let mut claimed_native: u64 = 0;
    for output in cb.outputs() {
        if output.value == 0 {
            return Err(LedgerError::ZeroValueOutput(cb.id()));
        }
        if output.asset_id.is_none() {
            claimed_native = claimed_native
                .checked_add(output.value)
                .ok_or(LedgerError::ValueOverflow)?;
        }
    }
    if claimed_native > allowed {
        return Err(LedgerError::CoinbaseOverspend {
            claimed: claimed_native,
            allowed,
        });
    }
    // RFC-006 supply cap (Bitcoin's MAX_MONEY analogue): cumulative native
    // issuance may never exceed MAX_SUPPLY. `cumulative_minted` is the total
    // minted in this block's view (selected parent + mergeset), so two
    // parallel near-cap blocks are each valid in their own view and only the
    // first in mergeset order survives the merged view — an excess mergeset
    // coinbase is dropped (the merged block does not apply), while an excess
    // coinbase in the block's own payload rejects the whole block.
    if cumulative_minted
        .checked_add(claimed_native)
        .map_or(true, |total| total > MAX_SUPPLY)
    {
        return Err(LedgerError::SupplyCapExceeded {
            claimed: claimed_native,
            native_minted: cumulative_minted,
            max_supply: MAX_SUPPLY,
        });
    }

    // NFT-specific validation for coinbase (KVP-106):
    // - For NonFungible assets, each output must have value == 1
    // - For NonFungible assets, cannot create multiple outputs of same asset_id in one tx
    // - Cannot mint an NFT that's already fully minted
    for output in cb.outputs() {
        if let Some(asset_id) = output.asset_id {
            if let Some(entry) = asset_registry.get(&asset_id) {
                if entry.is_nft() {
                    // NFT output must have value == 1
                    if output.value != 1 {
                        return Err(LedgerError::AssetNotConserved {
                            tx: cb.id(),
                            asset_id: Some(asset_id),
                            inputs: 1,
                            outputs: output.value,
                        });
                    }
                    // Check if already minted
                    if entry.is_fully_minted() {
                        return Err(LedgerError::AssetNotConserved {
                            tx: cb.id(),
                            asset_id: Some(asset_id),
                            inputs: 0,
                            outputs: 1,
                        });
                    }
                }
            }
        }
    }

    // Check for multiple outputs of same NFT in one coinbase transaction
    let mut nft_output_counts: HashMap<AssetId, usize> = HashMap::new();
    for output in cb.outputs() {
        if let Some(asset_id) = output.asset_id {
            if let Some(entry) = asset_registry.get(&asset_id) {
                if entry.is_nft() {
                    *nft_output_counts.entry(asset_id).or_insert(0) += 1;
                }
            }
        }
    }
    for (asset_id, count) in nft_output_counts {
        if count > 1 {
            return Err(LedgerError::AssetNotConserved {
                tx: cb.id(),
                asset_id: Some(asset_id),
                inputs: 0,
                outputs: count as u64,
            });
        }
    }

    // KVP-107: Asset creation fee
    // Check for new assets being created (not in registry) and require creation fee
    let creation_fee = if blue_score > MINT_PRICE_ACTIVATION_SCORE {
        let mut new_asset_count: u64 = 0;
        for output in cb.outputs() {
            if let Some(asset_id) = output.asset_id {
                if !asset_id.is_native() && !asset_registry.contains_key(&asset_id) {
                    new_asset_count = new_asset_count.saturating_add(1);
                }
            }
        }
        // KVP-107: Asset creation fee - miner must pay fee from their allowed claim
        new_asset_count
            .checked_mul(ASSET_CREATION_FEE)
            .ok_or(LedgerError::ValueOverflow)?
    } else {
        0
    };
    // The creation fee is deducted from what the miner can claim
    let allowed_after_fee = allowed.saturating_sub(creation_fee);
    if claimed_native > allowed_after_fee {
        return Err(LedgerError::CoinbaseOverspend {
            claimed: claimed_native,
            allowed: allowed_after_fee,
        });
    }

    add_outputs(staging, cb.id(), cb, height, true)?;
    Ok((claimed_native, creation_fee))
}

/// Insert every output of `tx` into `staging`. Coinbase outputs are flagged
/// for RFC-006 maturity.
fn add_outputs(
    staging: &mut UtxoSet,
    txid: TxId,
    tx: &Transaction,
    creation_height: u64,
    is_coinbase: bool,
) -> Result<(), LedgerError> {
    for (i, output) in tx.outputs().iter().enumerate() {
        let outpoint = OutPoint::new(txid, i as u32);
        let prev = if is_coinbase {
            staging.insert_coinbase(outpoint, *output, creation_height)
        } else {
            staging.insert_with_height(outpoint, *output, creation_height)
        };
        if prev.is_some() {
            return Err(LedgerError::OutputAlreadyExists(outpoint));
        }
    }
    Ok(())
}

/// The result of applying a whole DAG's worth of blocks in linearized order.
#[derive(Clone, Debug, Default)]
pub struct LedgerRun {
    /// The final UTXO set after applying every accepted block.
    pub utxo: UtxoSet,
    /// Blocks that applied cleanly, in linearization order.
    pub accepted: Vec<BlockId>,
    /// Blocks rejected as invalid, each with the reason. A block is rejected —
    /// not fatal — so a conflicting/invalid block never halts the ledger; it
    /// simply has no effect. Determined entirely by the GHOSTDAG order.
    pub rejected: Vec<(BlockId, LedgerError)>,
}

/// Apply an entire DAG: linearize it with GHOSTDAG, then apply each block's
/// transactions in that order against a fresh UTXO set.
///
/// This is a pure function of the DAG and `subsidy`: the linearization is
/// deterministic, and so is every state transition, so two nodes holding the
/// same DAG derive the identical [`LedgerRun`]. Conflicting spends across
/// parallel blocks are resolved by the linearization — the earlier block spends
/// the output; the later one is rejected with [`LedgerError::MissingInput`].
pub fn apply_dag(dag: &Dag, subsidy: u64) -> LedgerRun {
    let mut run = LedgerRun::default();
    // Chain heights (RFC-005 §3.2): the length of the selected-parent chain from
    // genesis — the clock the CLTV/CSV finality rules and per-UTXO creation
    // heights run on. This is NOT blue_score for a block with a mergeset (blue
    // score also counts merged blue blocks); the incremental Ledger tracks chain
    // heights in `self.heights`, so the batch path must agree with it.
    let mut heights: HashMap<BlockId, u64> = HashMap::new();
    // RFC-006: cumulative native minted across the linearization so far.
    let mut cumulative_minted: u64 = 0;
    for id in dag.linearize() {
        let payload = dag
            .block(&id)
            .expect("linearized id is present in the DAG")
            .payload();
        let ghostdag = dag.ghostdag(&id);
        let blue_score = ghostdag.map_or(0, |g| g.blue_score);
        // linearize() places every block after its selected parent, so the
        // parent's height is always known here.
        let height = ghostdag
            .and_then(|g| g.selected_parent)
            .and_then(|sp| heights.get(&sp).copied())
            .map_or(0, |h| h + 1);
        heights.insert(id, height);
        match decode_block_payload(payload) {
            Ok(txs) => {
                let mut asset_registry = HashMap::new();
                match apply_block_inner(
                    &mut run.utxo,
                    &mut asset_registry,
                    &txs,
                    subsidy,
                    cumulative_minted, // track cumulative minted for supply cap
                    height,
                    blue_score,
                    MULTISIG_ACTIVATION_SCORE,
                    NATIVE_TOKEN_ACTIVATION_SCORE,
                    STEALTH_ACTIVATION_SCORE,
                    SCRIPT_V2_ACTIVATION_SCORE,
                    HTLC_ACTIVATION_SCORE,
                    VAULT_ACTIVATION_SCORE,
                    MINT_PRICE_ACTIVATION_SCORE,
                    ASSET_LOGO_ACTIVATION_SCORE,
                ) {
                    Ok(summary) => {
                        cumulative_minted = cumulative_minted.saturating_add(summary.minted);
                        run.accepted.push(id);
                    }
                    Err(e) => run.rejected.push((id, e)),
                }
            }
            Err(e) => run.rejected.push((id, LedgerError::Payload(e))),
        }
    }
    run
}

/// Why [`Ledger::insert`] could not add a block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LedgerInsertError {
    /// The DAG rejected the block on structure (missing/duplicate parents, or an
    /// installed structural validator).
    Dag(DagError),
    /// The block's transactions are invalid against its view's UTXO state
    /// (a stateful rule: a missing/already-spent input, a bad signature, value
    /// not conserved, or coinbase overspend).
    State(LedgerError),
    /// A raw block's payload did not decode into transactions
    /// ([`Ledger::insert_raw_block`]).
    Payload(DecodeError),
    /// The block builds on final history — its selected parent's blue score is
    /// below the finality point, so it is rejected (a deep re-org).
    Finality {
        parent_score: u64,
        finality_score: u64,
    },
    /// The selected parent's view state could not be reconstructed — its stored
    /// delta is missing or the parent was a non-final block whose delta had
    /// not yet been recorded. This can happen when a block from a peer
    /// references a selected parent that the local ledger has not seen before.
    MissingParentDelta,
}

impl From<DagError> for LedgerInsertError {
    fn from(e: DagError) -> Self {
        LedgerInsertError::Dag(e)
    }
}

impl From<LedgerError> for LedgerInsertError {
    fn from(e: LedgerError) -> Self {
        LedgerInsertError::State(e)
    }
}

impl core::fmt::Display for LedgerInsertError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            LedgerInsertError::Dag(e) => write!(f, "dag rejected block: {e}"),
            LedgerInsertError::State(e) => write!(f, "invalid block state: {e}"),
            LedgerInsertError::Payload(e) => write!(f, "block payload undecodable: {e}"),
            LedgerInsertError::Finality {
                parent_score,
                finality_score,
            } => {
                write!(
                    f,
                    "finality violation: selected parent blue score {parent_score} < finality {finality_score}"
                )
            }
            LedgerInsertError::MissingParentDelta => write!(f, "selected parent delta missing"),
        }
    }
}

impl std::error::Error for LedgerInsertError {}

/// Net UTXO change of one block relative to its selected parent's view:
/// `created` are outputs present after the block but not before; `spent` are
/// outputs present before but not after. Applying a delta inserts `created`
/// then removes `spent`; reverting inserts `spent` then removes `created`.
/// Within one block the two lists are disjoint; across composed deltas an
/// outpoint created by the first part and spent by the second cancels under
/// the insert-then-remove order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct BlockDelta {
    spent: Vec<(OutPoint, UtxoEntry)>,
    created: Vec<(OutPoint, UtxoEntry)>,
}

/// Diff two UTXO sets into a net delta: `created` are outputs in `post` but
/// not `pre`, `spent` are outputs in `pre` but not `post`. Outputs are
/// immutable once created, so the two lists are disjoint.
fn diff_utxo(pre: &UtxoSet, post: &UtxoSet) -> BlockDelta {
    let mut spent = Vec::new();
    let mut created = Vec::new();
    for (op, entry) in pre.iter_entries() {
        if post.get_entry(op) != Some(entry) {
            spent.push((*op, *entry));
        }
    }
    for (op, entry) in post.iter_entries() {
        if pre.get_entry(op) != Some(entry) {
            created.push((*op, *entry));
        }
    }
    BlockDelta { spent, created }
}

/// Apply a net delta to a UTXO set: insert `created`, then remove `spent`.
/// The order matters — an outpoint created by one part of a composed delta and
/// spent by a later part must end up spent.
fn apply_delta(delta: &BlockDelta, state: &mut UtxoSet) {
    for (op, entry) in &delta.created {
        state.insert_entry(*op, *entry);
    }
    for (op, _) in &delta.spent {
        state.remove(op);
    }
}

/// Compose two deltas applied in sequence (`first` then `second`).
///
/// For the UTXO set this is plain concatenation: an outpoint cannot be spent by
/// `first` and created by `second` (its creator would have to be both in
/// `first`'s selected-parent past and in `second`'s mergeset — disjoint), and
/// an outpoint created by `first` and spent by `second` cancels under
/// [`apply_delta`]'s insert-then-remove order.
fn compose_delta(first: &BlockDelta, second: &BlockDelta) -> BlockDelta {
    let mut spent = first.spent.clone();
    spent.extend(second.spent.iter().copied());
    let mut created = first.created.clone();
    created.extend(second.created.iter().copied());
    BlockDelta { spent, created }
}

/// A DAG together with the **per-block UTXO view** each block induces.
///
/// [`apply_dag`] is the batch view: it (re)linearizes a finished DAG and folds
/// every transaction from scratch. A `Ledger` is the *incremental* view. It owns
/// a [`Dag`] and, for every non-final block `B`, stores a compact **delta**
/// describing the net change from `selected_parent(B)`'s view to `B`'s own view
/// — the state after applying, in the recursive GHOSTDAG order, every
/// transaction in `past(B) ∪ {B}`. That state is built cheaply from `B`'s
/// selected parent:
///
/// ```text
/// state(B) = apply( state(selected_parent(B)),
///                   mergeset(B) blocks' transactions (in order),
///                   B's own transactions )
/// ```
///
/// Because `B`'s transactions are checked against this pre-state *before* the
/// block is committed (via [`Dag::preview`]), a block that is invalid in its own
/// view — it double-spends an ancestor's output, carries a bad signature, mints
/// value, or overspends its coinbase — is rejected at insert and never enters
/// the DAG. (Two *parallel* blocks that spend the same output are each valid in
/// their own view and both admitted; their conflict is resolved only in the view
/// of a block that merges them, exactly as GHOSTDAG intends.)
///
/// The structural [`TxStructureValidator`] is also installed on the underlying
/// DAG, so malformed blocks are rejected even if the DAG is used directly.
///
/// State is kept as a **single materialised UTXO set at the selected tip** plus
/// compact per-block undo deltas (Bitcoin/Kaspa UTXO + undo-log style):
/// `deltas[&b]` records the net UTXO change from `b`'s selected parent's view to
/// `b`'s own view. Any
/// non-final block's view can be reconstructed on demand by walking its
/// selected-parent chain and applying deltas. Final blocks' deltas are folded
/// into their children before being dropped, so a child's delta is always
/// relative to the deepest non-final ancestor in its chain. Folding is
/// compositional and pruning is idempotent: applying the folded delta reproduces
/// the same view as the original sequence, and calling [`Self::prune`] twice at
/// the same finality threshold removes no additional state. Memory is bounded to
/// `O(U + n·d)` (one tip state plus per-block deltas) instead of `O(n·U)`.
///
/// ## Finality and pruning
///
/// A `Ledger` built with [`Ledger::with_finality`] treats blocks more than
/// `finality_depth` blue score below the selected tip as **final**: no new block
/// may build on them (their selected parent being final is a
/// [`LedgerInsertError::Finality`]), so their stored per-block state is no longer
/// needed and is **pruned**, bounding memory. This also makes the selected chain
/// stable below the finality point — a deep re-org is rejected rather than
/// applied. Above the finality point, re-orgs are implicit: [`Ledger::ledger_state`]
/// always follows the current selected tip, so a heavier branch takes over with no
/// explicit revert. [`Ledger::new`] uses an unbounded depth — it never prunes and
/// never rejects on finality.
///
/// ## Payload pruning
///
/// Independently of the ledger's finality pruning, the underlying [`Dag`]
/// supports **payload pruning** via [`Dag::set_payload_pruning_depth`]. This
/// evicts the opaque transaction payloads of blocks whose blue score is more than
/// `payload_pruning_depth` below the selected tip. The payload pruning depth is
/// typically set larger than the finality depth so that a node can serve block
/// bodies for blocks that are final (and thus immutable) but no longer needed for
/// validation. See [`kovanica_dag::Dag`] for details.
///
/// ## Block pruning
///
/// The underlying [`Dag`] also supports **block pruning** via
/// [`Dag::set_block_pruning_depth`]: blocks more than `block_pruning_depth` blue
/// score below the selected tip are evicted entirely — payload, consensus
/// metadata, and their reachability-oracle entries — bounding the oracle's
/// memory to `O(block_pruning_depth × width)` instead of growing with the chain.
/// This is the knob that bounds the oracle's interval + future-covering-set maps
/// (the dominant memory term on a long-lived node). It is consensus-safe when
/// `block_pruning_depth >= finality_depth`: every evicted block is already final,
/// so [`DagError::BuildsOnPrunedHistory`] fires only for blocks the finality
/// check would already reject. See [`kovanica_dag::Dag`] for details.
pub struct Ledger {
    dag: Dag,
    schedule: HalvingSchedule,
    genesis: BlockId,
    /// Blocks this far in blue score below the selected tip are final; their
    /// state is pruned and they cannot be built on. `u64::MAX` = never.
    finality_depth: u64,
    /// Payload pruning depth for the underlying DAG: blocks this far in blue
    /// score below the selected tip have their payloads evicted. `u64::MAX` = never.
    payload_pruning_depth: u64,
    /// Block pruning depth for the underlying DAG: blocks this far in blue score
    /// below the selected tip are evicted entirely (payload, metadata, and
    /// reachability-oracle entries). `u64::MAX` = never.
    block_pruning_depth: u64,
    /// When `true`, the ledger is replaying a log/snapshot/checkpoint and
    /// consensus checks that are only for live blocks (e.g., DAG pruning
    /// invariant `BuildsOnPrunedHistory`) are skipped. This allows anticone
    /// blocks linearized last to be re-inserted even if their selected parent
    /// is in the pruned region.
    replay_mode: bool,
    /// The UTXO state at the selected tip — the single materialised state.
    tip_state: UtxoSet,
    /// Asset registry: tracks per-asset metadata, supply, and NFT-specific fields.
    /// Keyed by AssetId. Native KVNC (AssetId::native()) is not stored here.
    asset_registry: HashMap<AssetId, AssetRegistryEntry>,
    /// Per-block net undo deltas: `deltas[&b]` is the net change from `b`'s
    /// selected parent's view to `b`'s own view (or from the empty set when the
    /// selected parent is final — see [`Self::prune`]). Non-final blocks only.
    deltas: HashMap<BlockId, BlockDelta>,
    /// Proof-of-Authority admission policy (RFC-POA §3–4); `None` = PoA off.
    poa: Option<PoAConfig>,
    /// Block heights: `heights[&b]` is the height of block `b` in the selected chain.
    heights: HashMap<BlockId, u64>,
    /// Selected-parent pointer for every live block, kept independently of the
    /// DAG so that [`Self::reconstruct_state`] and delta pruning keep working
    /// after a block has been block-pruned (evicted from the DAG). An absent
    /// entry means the block's anchor is the empty set: either genesis, or a
    /// block re-anchored to the root because its ancestors' deltas have been
    /// folded into it by [`Self::prune_one`].
    selected_parents: HashMap<BlockId, BlockId>,
    /// Blue score activation threshold for Version 0x01 multisig transactions.
    multisig_activation_score: u64,
    /// Blue score activation threshold for native token transactions.
    native_token_activation_score: u64,
    /// Blue score activation threshold for RFC-003 stealth address transactions.
    stealth_activation_score: u64,
    /// Blue score activation threshold for RFC-003 script v2 transactions.
    script_v2_activation_score: u64,
    /// Blue score activation threshold for RFC-004 HTLC transactions.
    htlc_activation_score: u64,
    /// Blue score activation threshold for RFC-005 vault transactions.
    vault_activation_score: u64,
    /// KVP-107: blue score activation threshold for mint price enforcement.
    mint_price_activation_score: u64,
    /// KVP-107: blue score activation threshold for asset logo/metadata.
    asset_logo_activation_score: u64,
    /// RFC-006: cumulative native KVNC atoms minted on the selected chain.
    native_minted: u64,
    /// RFC-006: cumulative fee atoms burned (75% of selected-chain fees).
    fees_burned: u64,
    /// Cumulative native mint in each block's view (selected-parent chain +
    /// mergeset coinbases + own coinbase); the selected tip's entry is the
    /// total minted in its past.
    block_minted: HashMap<BlockId, u64>,
    /// Cumulative fee burn in each block's view (selected-parent chain +
    /// mergeset txs + own txs, each block contributing `fees - fees/4`); the
    /// selected tip's entry is the total burned in its past. Stored as the
    /// per-block sum so `fees_burned` is exact (the cumulative floor
    /// `total - total/4` differs from the true sum of per-block burns).
    block_fees: HashMap<BlockId, u64>,
}

impl Ledger {
    /// Create a ledger whose genesis block carries `genesis_txs` (typically a
    /// single coinbase minting the initial supply). `k` is the GHOSTDAG
    /// parameter and `schedule` the halving schedule for per-block issuance.
    ///
    /// Fails if `genesis_txs` are not a valid block on an empty UTXO set.
    pub fn new(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
    ) -> Result<Self, LedgerError> {
        // Genesis may mint premine+treasury up to MAX_SUPPLY; curve applies after.
        let mut state = UtxoSet::new();
        let summary = apply_block(&mut state, genesis_txs, MAX_SUPPLY)?;
        if summary.minted > MAX_SUPPLY {
            return Err(LedgerError::SupplyCapExceeded {
                claimed: summary.minted,
                native_minted: 0,
                max_supply: MAX_SUPPLY,
            });
        }

        let genesis = Block::genesis(1, 0, 0, encode_block_payload(genesis_txs));
        let genesis_id = genesis.id();
        let mut dag = Dag::with_validator(k, genesis, Box::new(TxStructureValidator));
        dag.set_payload_pruning_depth(u64::MAX);
        dag.set_block_pruning_depth(u64::MAX);

        // Genesis's delta is relative to the empty set: applying it to an empty
        // UTXO set reproduces the genesis state.
        let genesis_delta = diff_utxo(&UtxoSet::new(), &state);
        let mut deltas = HashMap::new();
        deltas.insert(genesis_id, genesis_delta);
        let mut heights = HashMap::new();
        heights.insert(genesis_id, 0);
        let mut block_minted = HashMap::new();
        block_minted.insert(genesis_id, summary.minted);
        let burned = summary.fees.saturating_sub(summary.fees / FEE_PRODUCER_DEN);
        let mut block_fees = HashMap::new();
        block_fees.insert(genesis_id, burned);
        Ok(Self {
            dag,
            schedule,
            genesis: genesis_id,
            finality_depth: u64::MAX,
            payload_pruning_depth: u64::MAX,
            block_pruning_depth: u64::MAX,
            tip_state: state,
            asset_registry: HashMap::new(),
            deltas,
            poa: None,
            heights,
            selected_parents: HashMap::new(),
            multisig_activation_score: MULTISIG_ACTIVATION_SCORE,
            native_token_activation_score: NATIVE_TOKEN_ACTIVATION_SCORE,
            stealth_activation_score: STEALTH_ACTIVATION_SCORE,
            script_v2_activation_score: SCRIPT_V2_ACTIVATION_SCORE,
            htlc_activation_score: HTLC_ACTIVATION_SCORE,
            vault_activation_score: VAULT_ACTIVATION_SCORE,
            mint_price_activation_score: MINT_PRICE_ACTIVATION_SCORE,
            asset_logo_activation_score: ASSET_LOGO_ACTIVATION_SCORE,
            native_minted: summary.minted,
            fees_burned: burned,
            block_minted,
            block_fees,
            replay_mode: false,
        })
    }

    /// Set the blue-score activation threshold for Version 0x01 multisig transactions.
    pub fn set_multisig_activation_score(&mut self, score: u64) {
        self.multisig_activation_score = score;
    }

    /// The blue-score activation threshold for Version 0x01 multisig transactions.
    pub fn multisig_activation_score(&self) -> u64 {
        self.multisig_activation_score
    }

    /// Set the blue-score activation threshold for native token transactions.
    pub fn set_native_token_activation_score(&mut self, score: u64) {
        self.native_token_activation_score = score;
    }

    /// The blue-score activation threshold for native token transactions.
    pub fn native_token_activation_score(&self) -> u64 {
        self.native_token_activation_score
    }

    /// Set the blue-score activation threshold for RFC-003 stealth address transactions.
    pub fn set_stealth_activation_score(&mut self, score: u64) {
        self.stealth_activation_score = score;
    }

    /// The blue-score activation threshold for RFC-003 stealth address transactions.
    pub fn stealth_activation_score(&self) -> u64 {
        self.stealth_activation_score
    }

    /// Set the blue-score activation threshold for RFC-003 script v2 transactions.
    pub fn set_script_v2_activation_score(&mut self, score: u64) {
        self.script_v2_activation_score = score;
    }

    /// The blue-score activation threshold for RFC-003 script v2 transactions.
    pub fn script_v2_activation_score(&self) -> u64 {
        self.script_v2_activation_score
    }

    /// Set the blue-score activation threshold for RFC-004 HTLC transactions.
    pub fn set_htlc_activation_score(&mut self, score: u64) {
        self.htlc_activation_score = score;
    }

    /// The blue-score activation threshold for RFC-004 HTLC transactions.
    pub fn htlc_activation_score(&self) -> u64 {
        self.htlc_activation_score
    }

    /// Set the blue-score activation threshold for RFC-005 vault transactions.
    pub fn set_vault_activation_score(&mut self, score: u64) {
        self.vault_activation_score = score;
    }

    /// The blue-score activation threshold for RFC-005 vault transactions.
    pub fn vault_activation_score(&self) -> u64 {
        self.vault_activation_score
    }

    /// Set the blue-score activation threshold for KVP-107 mint price enforcement.
    pub fn set_mint_price_activation_score(&mut self, score: u64) {
        self.mint_price_activation_score = score;
    }

    /// The blue-score activation threshold for KVP-107 mint price enforcement.
    pub fn mint_price_activation_score(&self) -> u64 {
        self.mint_price_activation_score
    }

    /// Set the blue-score activation threshold for KVP-107 asset logo/metadata.
    pub fn set_asset_logo_activation_score(&mut self, score: u64) {
        self.asset_logo_activation_score = score;
    }

    /// The blue-score activation threshold for KVP-107 asset logo/metadata.
    pub fn asset_logo_activation_score(&self) -> u64 {
        self.asset_logo_activation_score
    }

    /// Like [`Ledger::new`], but with a finite finality depth: blocks more than
    /// `finality_depth` blue score below the selected tip become final — they may
    /// not be built on, and their per-block state is pruned. See the type docs.
    pub fn with_finality(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
        finality_depth: u64,
    ) -> Result<Self, LedgerError> {
        let mut ledger = Self::new(k, schedule, genesis_txs)?;
        ledger.finality_depth = finality_depth;
        Ok(ledger)
    }

    /// Like [`Ledger::new`], but with a finite payload pruning depth for the
    /// underlying DAG: blocks more than `payload_pruning_depth` blue score below
    /// the selected tip have their payloads evicted. This is independent of the
    /// ledger's finality pruning (which prunes per-block UTXO state and rejects
    /// blocks built on final history). Typically `payload_pruning_depth >=
    /// finality_depth` so that final blocks' bodies can still be served for sync.
    pub fn with_payload_pruning(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
        payload_pruning_depth: u64,
    ) -> Result<Self, LedgerError> {
        let mut ledger = Self::new(k, schedule, genesis_txs)?;
        ledger.payload_pruning_depth = payload_pruning_depth;
        ledger.dag.set_payload_pruning_depth(payload_pruning_depth);
        Ok(ledger)
    }

    /// Like [`Ledger::with_finality`], but with both finality depth and payload
    /// pruning depth specified.
    pub fn with_finality_and_payload_pruning(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
        finality_depth: u64,
        payload_pruning_depth: u64,
    ) -> Result<Self, LedgerError> {
        let mut ledger = Self::new(k, schedule, genesis_txs)?;
        ledger.finality_depth = finality_depth;
        ledger.payload_pruning_depth = payload_pruning_depth;
        ledger.dag.set_payload_pruning_depth(payload_pruning_depth);
        Ok(ledger)
    }

    /// Like [`Ledger::new`], but with a finite block pruning depth for the
    /// underlying DAG: blocks more than `block_pruning_depth` blue score below
    /// the selected tip are evicted entirely (payload, consensus metadata, and
    /// reachability-oracle entries). This bounds the oracle's memory to
    /// `O(block_pruning_depth × width)` instead of growing with the chain.
    /// Consensus-safe when `block_pruning_depth >= finality_depth` — every
    /// evicted block is already final, so `BuildsOnPrunedHistory` fires only for
    /// blocks the finality check would already reject.
    pub fn with_block_pruning(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
        block_pruning_depth: u64,
    ) -> Result<Self, LedgerError> {
        let mut ledger = Self::new(k, schedule, genesis_txs)?;
        ledger.apply_block_pruning_depth(block_pruning_depth);
        Ok(ledger)
    }

    /// Like [`Ledger::with_finality`], but with both finality depth and block
    /// pruning depth specified.
    pub fn with_finality_and_block_pruning(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
        finality_depth: u64,
        block_pruning_depth: u64,
    ) -> Result<Self, LedgerError> {
        let mut ledger = Self::new(k, schedule, genesis_txs)?;
        ledger.finality_depth = finality_depth;
        ledger.apply_block_pruning_depth(block_pruning_depth);
        Ok(ledger)
    }

    /// Like [`Ledger::new`], but with all three pruning depths specified
    /// (finality, payload, and block). `u64::MAX` disables any of them. This is
    /// the combined constructor the node profile uses — a single call replaces
    /// the pairwise builder matrix.
    pub fn with_pruning(
        k: KParam,
        schedule: HalvingSchedule,
        genesis_txs: &[Transaction],
        finality_depth: u64,
        payload_pruning_depth: u64,
        block_pruning_depth: u64,
    ) -> Result<Self, LedgerError> {
        let mut ledger = Self::new(k, schedule, genesis_txs)?;
        ledger.finality_depth = finality_depth;
        ledger.payload_pruning_depth = payload_pruning_depth;
        ledger.dag.set_payload_pruning_depth(payload_pruning_depth);
        ledger.apply_block_pruning_depth(block_pruning_depth);
        Ok(ledger)
    }

    /// Borrow the underlying DAG (for consensus queries: tips, ghostdag,
    /// `linearize`, `selected_chain`, …).
    pub fn dag(&self) -> &Dag {
        &self.dag
    }

    /// Borrow the asset registry (for KVP-106 NFT metadata queries).
    pub fn asset_registry(&self) -> &HashMap<AssetId, AssetRegistryEntry> {
        &self.asset_registry
    }

    /// The finality depth (blue score below the selected tip). `u64::MAX` means
    /// finality/pruning is disabled.
    pub fn finality_depth(&self) -> u64 {
        self.finality_depth
    }

    /// Set the finality depth (blue score below the selected tip). Blocks below
    /// the resulting threshold become final: their per-block state is pruned and
    /// they may not be built on. `u64::MAX` disables finality/pruning.
    ///
    /// Unlike [`Self::with_finality`] (which builds a ledger with the policy from
    /// genesis), this applies the policy to an already-built ledger — the
    /// intended path for a node loaded from a replay log, which otherwise runs
    /// with finality disabled (`u64::MAX`) and never prunes. The prune runs
    /// immediately, so enabling finality on a loaded chain drops the now-final
    /// blocks' state right away.
    pub fn set_finality_depth(&mut self, depth: u64) {
        self.finality_depth = depth;
        self.prune();
        // RFC-008: keep block pruning at or above the (possibly raised) finality
        // depth, so it can never evict a block the ledger still needs.
        self.apply_block_pruning_depth(self.block_pruning_depth);
    }

    /// The blue-score threshold below which blocks are final: blocks with a blue
    /// score `< finality_score()` are pruned and may not be built on. `0` when
    /// finality is disabled or the DAG is not yet `finality_depth` deep.
    pub fn finality_score(&self) -> u64 {
        if self.finality_depth == u64::MAX {
            return 0;
        }
        let tip = self.dag.selected_tip();
        let max = self.dag.ghostdag(&tip).map_or(0, |g| g.blue_score);
        max.saturating_sub(self.finality_depth)
    }

    /// The payload pruning depth for the underlying DAG. `u64::MAX` means pruning
    /// is disabled.
    pub fn payload_pruning_depth(&self) -> u64 {
        self.payload_pruning_depth
    }

    /// The selected tip's blue score — the chain height a block building on the
    /// current tips will approximately reach (the ledger assigns each new block
    /// its selected parent's height + 1).
    pub fn tip_blue_score(&self) -> u64 {
        let tip = self.dag.selected_tip();
        self.dag.ghostdag(&tip).map_or(0, |g| g.blue_score)
    }

    /// The blue-score threshold below which blocks' payloads are pruned in the
    /// underlying DAG. Returns `0` when pruning is disabled or the DAG is not yet
    /// deep enough. See [`Dag::payload_pruning_score`].
    pub fn payload_pruning_score(&self) -> u64 {
        self.dag.payload_pruning_score()
    }

    /// Set the payload pruning depth on the underlying DAG and immediately
    /// prune payloads of blocks that are now beyond the threshold.
    pub fn set_payload_pruning_depth(&mut self, depth: u64) {
        self.payload_pruning_depth = depth;
        self.dag.set_payload_pruning_depth(depth);
        self.dag.prune_old_payloads();
    }

    /// The block pruning depth for the underlying DAG. `u64::MAX` means pruning
    /// is disabled.
    pub fn block_pruning_depth(&self) -> u64 {
        self.block_pruning_depth
    }

    /// The blue-score threshold below which blocks are evicted in the underlying
    /// DAG. Returns `0` when pruning is disabled or the DAG is not yet deep
    /// enough. See [`Dag::block_pruning_score`].
    pub fn block_pruning_score(&self) -> u64 {
        self.dag.block_pruning_score()
    }

    /// Set the block pruning depth on the underlying DAG and prune immediately.
    ///
    /// Unlike [`Self::with_block_pruning`] (which builds a ledger with the policy
    /// from genesis), this applies the policy to an already-built ledger — the
    /// intended path for a node loaded from a replay log, which otherwise runs
    /// with block pruning disabled (`u64::MAX`) and never evicts. The eviction
    /// runs immediately, so enabling block pruning on a loaded chain drops the
    /// now-evictable blocks' oracle entries right away.
    ///
    /// **RFC-008 invariant:** the effective depth is clamped to at least the
    /// finality depth. A block is only safe to evict once it is final — its
    /// per-block state has been pruned and [`Self::reconstruct_state`] stops at
    /// the finality boundary before reaching it. Evicting a non-final block
    /// would make its descendants' state unreconstructable. With finality
    /// disabled (`u64::MAX`) this disables block pruning too.
    pub fn set_block_pruning_depth(&mut self, depth: u64) {
        self.apply_block_pruning_depth(depth);
    }

    /// Clamp `depth` to the RFC-008 invariant (`>= finality_depth`) and apply it
    /// to the DAG, evicting immediately. Shared by the setters and builders so
    /// no path can evict a non-final block.
    fn apply_block_pruning_depth(&mut self, depth: u64) {
        let depth = depth.max(self.finality_depth);
        self.block_pruning_depth = depth;
        self.dag.set_block_pruning_depth(depth);
        self.dag.prune_old_blocks();
    }

    /// Enable or disable replay mode. When enabled, consensus checks that are
    /// only for live blocks (e.g., DAG pruning invariant `BuildsOnPrunedHistory`)
    /// are skipped. This allows anticone blocks linearized last to be re-inserted
    /// even if their selected parent is in the pruned region.
    pub fn set_replay_mode(&mut self, enabled: bool) {
        self.replay_mode = enabled;
        if enabled {
            // Disable block pruning during replay: the log's linearized order may
            // reference selected parents deep in history that would be evicted by
            // normal block pruning. Payload pruning still runs to bound memory.
            self.block_pruning_depth = u64::MAX;
            self.dag.set_block_pruning_depth(u64::MAX);
        }
    }

    /// The genesis block id.
    pub fn genesis(&self) -> BlockId {
        self.genesis
    }

    /// The subsidy for the next block (based on the selected tip's height).
    pub fn subsidy(&self) -> u64 {
        let tip = self.dag.selected_tip();
        let height = self.heights.get(&tip).copied().unwrap_or(0);
        self.schedule.subsidy_at(height + 1)
    }

    /// The emission schedule.
    pub fn schedule(&self) -> HalvingSchedule {
        self.schedule
    }

    /// RFC-006: cumulative native atoms minted.
    pub fn native_minted(&self) -> u64 {
        self.native_minted
    }

    /// RFC-006: cumulative fee atoms burned.
    pub fn fees_burned(&self) -> u64 {
        self.fees_burned
    }

    /// Sum of recorded native mint along the selected-parent chain ending at `tip`
    /// (inclusive), walking via GHOSTDAG selected parents.
    /// The cumulative native mint recorded in `tip`'s view.
    ///
    /// `block_minted[id]` stores the **cumulative** view total (selected-parent
    /// chain + all mergeset coinbases + the block's own coinbase), so the
    /// selected tip's entry IS the total minted in its past — an O(1) lookup.
    fn chain_minted_through(&self, tip: BlockId) -> u64 {
        self.block_minted.get(&tip).copied().unwrap_or(0)
    }

    /// The cumulative fee burn recorded in `tip`'s view (selected-parent chain
    /// + all mergeset txs + the block's own txs, each contributing
    ///   `fees - fees/4`).
    ///
    /// `block_fees[id]` stores the **cumulative** view burn, mirroring
    /// `block_minted`, so the selected tip's entry IS the total burned in its
    /// past — an O(1) lookup.
    fn chain_fees_burned_through(&self, tip: BlockId) -> u64 {
        self.block_fees.get(&tip).copied().unwrap_or(0)
    }

    /// The chain height of `block` in the selected-parent chain, computed by
    /// walking selected parents until a block with a known height is reached.
    /// Mirrors `apply_dag`'s height computation (`height = sp_height + 1`), so
    /// the incremental and batch paths agree on every block's chain height.
    ///
    /// The `heights` map is pruned for final blocks, but ghostdag data
    /// (selected-parent pointers) is retained, so the walk can reconstruct the
    /// height of a final block from the nearest non-final ancestor. Returns
    /// `None` only when the walk is impossible — the whole chain below the
    /// finality boundary is pruned (callers fall back to blue score).
    pub fn chain_height_of(&self, block: BlockId) -> Option<u64> {
        let mut steps = 0u64;
        let mut cur = block;
        loop {
            if let Some(h) = self.heights.get(&cur) {
                return Some(h + steps);
            }
            let sp = self.dag.ghostdag(&cur).and_then(|g| g.selected_parent)?;
            cur = sp;
            steps += 1;
        }
    }

    /// The selected tip's linearized chain height, or `None` if it cannot be
    /// reconstructed (the whole chain below the finality boundary is pruned).
    ///
    /// ⚠️ This is **not** [`Self::tip_blue_score`]: blue score is the size of
    /// the tip's blue set and outruns chain height by a wide, growing margin.
    /// Coinbase maturity (RFC-006, [`COINBASE_MATURITY`]) is measured in
    /// linearized chain height, so wallet-facing UTXO selection must use this,
    /// not the blue score.
    pub fn tip_chain_height(&self) -> Option<u64> {
        self.chain_height_of(self.dag.selected_tip())
    }

    /// Recompute `native_minted` / `fees_burned` from the selected tip's
    /// cumulative view totals. Both maps are cumulative, so the tip's entry is
    /// the total in its past — summing along the chain would double-count.
    /// `block_fees` stores the cumulative **per-block burn** (each block
    /// contributes `fees - fees/4`), so `fees_burned` is the exact sum of
    /// per-block burns, not the cumulative floor `total - total/4`.
    fn recompute_supply(&mut self) {
        let tip = self.dag.selected_tip();
        self.native_minted = self.block_minted.get(&tip).copied().unwrap_or(0);
        self.fees_burned = self.block_fees.get(&tip).copied().unwrap_or(0);
    }

    /// Update the asset registry with newly minted assets from coinbase outputs.
    fn update_asset_registry(&mut self, txs: &[Transaction], is_coinbase_block: bool) {
        for tx in txs {
            let is_coinbase = tx.is_coinbase();
            // Decode creation params from the tag (KVP-107).
            let creation_params = AssetCreationParams::decode(tx.tag());

            // Only process if it's a coinbase block OR if the tx carries creation params.
            if is_coinbase {
                if !is_coinbase_block {
                    continue; // Only update for coinbase blocks
                }
            } else if creation_params.is_none() {
                continue; // Regular tx without creation params - nothing to register
            }

            for output in tx.outputs() {
                if let Some(asset_id) = output.asset_id {
                    if asset_id.is_native() {
                        continue; // Skip native KVNC
                    }
                    // Only register if asset is new (not already in registry)
                    if self.asset_registry.contains_key(&asset_id) {
                        continue;
                    }
                    let entry = self.asset_registry.entry(asset_id).or_insert_with(|| {
                        if let Some(params) = &creation_params {
                            // Has creation params - use them
                            if output.value == 1 {
                                AssetRegistryEntry::new_nft_with_mint_price(
                                    asset_id,
                                    params.mint_price_per_unit,
                                    params.logo_uri.clone(),
                                    params.metadata_uri.clone(),
                                    params.creator,
                                )
                            } else {
                                AssetRegistryEntry::new_fungible_with_mint_price(
                                    asset_id,
                                    u64::MAX,
                                    params.mint_price_per_unit,
                                    params.logo_uri.clone(),
                                    params.metadata_uri.clone(),
                                    params.creator,
                                )
                            }
                        } else if output.value == 1 {
                            // Legacy coinbase NFT
                            AssetRegistryEntry::new_nft(asset_id, None, None, None)
                        } else {
                            // Legacy coinbase fungible
                            AssetRegistryEntry::new_fungible(asset_id, u64::MAX)
                        }
                    });
                    // For NFTs, increment minted
                    if entry.is_nft() {
                        entry.minted = entry.minted.saturating_add(output.value);
                    }
                }
            }
        }
    }

    /// RFC-006 supply metrics at the selected tip.
    pub fn supply(&self) -> SupplyMetrics {
        let circulating = self.tip_state.total_value().min(u128::from(u64::MAX)) as u64;
        SupplyMetrics {
            total: self.native_minted,
            circulating,
            burned: self.fees_burned,
            max_supply: MAX_SUPPLY,
        }
    }

    /// The UTXO state in `block`'s own view, if `block` is present.
    ///
    /// Reconstructed on demand from the per-block undo deltas (the selected
    /// tip's state is materialised and returned directly). `None` for blocks
    /// that are final (their deltas were folded into their children and
    /// dropped) or absent from the DAG.
    pub fn state(&self, block: &BlockId) -> Option<UtxoSet> {
        if *block == self.dag.selected_tip() {
            return Some(self.tip_state.clone());
        }
        self.reconstruct_state(block)
    }

    /// Whether `id` is final: below the finality score, so its delta has been
    /// folded into its children and dropped. `false` when finality is disabled
    /// or not yet active.
    ///
    /// An **evicted** block (absent from the DAG because block pruning removed
    /// it) is treated as final: by the RFC-008 invariant block pruning only
    /// evicts final blocks, so this is what stops [`Self::reconstruct_state`]
    /// at the pruning boundary instead of walking into a block the DAG no longer
    /// knows.
    fn is_final(&self, id: &BlockId) -> bool {
        let threshold = self.finality_score();
        if threshold == 0 {
            return false;
        }
        match self.dag.ghostdag(id) {
            Some(g) => g.blue_score < threshold,
            None => true,
        }
    }

    /// Reconstruct the UTXO state in `block`'s view from the undo log.
    ///
    /// Walks `block`'s selected-parent chain down to the deepest non-final
    /// ancestor (or genesis when nothing is final). That block's delta is
    /// relative to the empty set — either it is genesis, or its selected parent
    /// is final and the prune-time folding made it so — so applying the deltas
    /// back up the chain reproduces `block`'s view exactly. `None` when `block`
    /// is absent, final (its delta was dropped), or its chain crosses a missing
    /// delta.
    ///
    /// During replay the finality boundary moves, so the stop condition is not
    /// "is the parent final" but "is the parent's delta still stored": a
    /// parent's delta is present until it is pruned, and pruning always folds
    /// it into its children, so a block whose selected parent's delta is gone
    /// is already relative to the empty set. That is the only condition under
    /// which stopping early is complete, and it holds identically for the live
    /// path and for mid-replay pruning.
    fn reconstruct_state(&self, block: &BlockId) -> Option<UtxoSet> {
        let mut path = vec![*block];
        let mut cur = *block;
        // Use the ledger's own selected-parent pointer rather than the DAG:
        // after block pruning the DAG no longer knows `cur`'s selected parent
        // (it returns `None` for an evicted block), which is exactly the R7 gap.
        // An absent entry means `cur` is an anchor — genesis, a re-anchored fold
        // point, or a restored checkpoint — whose delta is relative to the empty
        // set.
        while let Some(sp) = self.selected_parents.get(&cur).copied() {
            // The parent's delta was pruned, so it was folded into this block's
            // delta: the accumulated path below is the whole state and we can
            // stop.
            if !self.deltas.contains_key(&sp) {
                break;
            }
            path.push(sp);
            cur = sp;
        }
        let mut state = UtxoSet::new();
        for p in path.iter().rev() {
            let delta = self.deltas.get(p)?;
            apply_delta(delta, &mut state);
        }
        Some(state)
    }

    /// Enable Proof-of-Authority admission with `authority_set` and
    /// `slot_duration_ms` (RFC-POA §3–4).
    ///
    /// PoA is the **only** admission regime: the authority/slot check (see
    /// [`kovanica_dag::Dag::set_poa`]) plus the per-block `work` pin to
    /// `POA_NOMINAL_WORK` replace what used to be dag-level PoW, difficulty
    /// pinning, and staked-VRF sortition. Restoring a snapshot/checkpoint that
    /// contains PoA blocks requires PoA to be re-enabled before replay (see
    /// [`Ledger::read_snapshot_with_poa`] / [`Ledger::read_checkpoint_with_poa`]).
    pub fn set_poa(&mut self, authority_set: AuthoritySet, slot_duration_ms: u64) {
        // The ledger owns admission now.
        self.dag.set_poa(authority_set, slot_duration_ms);
        self.poa = self.dag.poa_config().cloned();
    }

    /// Whether Proof-of-Authority admission is enabled.
    pub fn poa_enabled(&self) -> bool {
        self.poa.is_some()
    }

    /// The active PoA policy, if any ([`Ledger::set_poa`]).
    pub fn poa_config(&self) -> Option<PoAConfig> {
        self.poa.clone()
    }

    /// Apply an on-chain authority set update (RFC-POA §1, KVP-201).
    ///
    /// Delegates to the DAG for validation; on success, updates the ledger's
    /// cached PoA config and returns the new AuthoritySet.
    pub fn apply_authority_update(
        &mut self,
        update: &AuthorityUpdateTx,
    ) -> Result<AuthoritySet, AuthorityError> {
        let new_set = self.dag.apply_authority_update(update)?;
        self.poa = self.dag.poa_config().cloned();
        Ok(new_set)
    }

    /// Insert a block referencing `parents`, carrying `work`, `timestamp_ms`,
    /// `nonce`, and `txs`.
    ///
    /// Validates `txs` against the block's view UTXO state and, on success, adds
    /// the block to the DAG and stores its per-block state. On any error the
    /// ledger and DAG are left unchanged and the block is not added.
    ///
    /// This is the **template** path: it builds a fresh [`Block`], so it cannot
    /// carry an authority signature. Under PoA (see [`Ledger::set_poa`]) every
    /// block needs one, so use [`Ledger::insert_prepared_block`] with a
    /// [`Block::new_with_authority`] block. `work` is pinned to
    /// `POA_NOMINAL_WORK` at admission under PoA and `nonce` is unconstrained
    /// (pass `0`).
    pub fn insert(
        &mut self,
        parents: Vec<BlockId>,
        work: u128,
        timestamp_ms: u64,
        nonce: u64,
        txs: &[Transaction],
    ) -> Result<BlockId, LedgerInsertError> {
        let block = Block::new(
            parents,
            work,
            timestamp_ms,
            nonce,
            encode_block_payload(txs),
        );
        self.apply_new_block(block, txs)
    }

    /// Insert an already-assembled `block` whose payload decodes to `txs`.
    ///
    /// This is the identity-preserving path: the block's id is taken as given, so
    /// peers and snapshot/checkpoint replays can re-admit exactly the block they
    /// received (and PoA blocks keep their authority signature). All admission
    /// rules — stateful transaction validation and the authority/slot check —
    /// still run; only the re-encoding of parents/work/timestamp into a fresh
    /// template is skipped.
    pub fn insert_prepared_block(
        &mut self,
        block: Block,
        txs: &[Transaction],
    ) -> Result<BlockId, LedgerInsertError> {
        self.apply_new_block(block, txs)
    }

    /// Like [`Ledger::insert_prepared_block`], but the transactions are decoded
    /// from the block's own payload. Used by snapshot/checkpoint replays.
    pub fn insert_raw_block(&mut self, block: Block) -> Result<BlockId, LedgerInsertError> {
        let txs = decode_block_payload(block.payload()).map_err(LedgerInsertError::Payload)?;
        self.insert_prepared_block(block, &txs)
    }

    /// Shared admission pipeline behind every public insert entry point.
    fn apply_new_block(
        &mut self,
        block: Block,
        txs: &[Transaction],
    ) -> Result<BlockId, LedgerInsertError> {
        // Build the block's view pre-state: its selected parent's state with the
        // mergeset blocks' transactions applied in order. Previewing gets the
        // selected parent and mergeset without mutating the DAG.
        let preview = self.dag.preview(&block)?;

        // Finality: a block may not build on final history. Its selected parent
        // being final means its state has been pruned, so this check also
        // guarantees the state lookup below succeeds.
        //
        // This is a **live-admission** rule, not a replay rule. It rejects a
        // block that arrives *now* on top of history the ledger has already
        // discarded, because such a block's pre-state is unrecoverable going
        // forward. Replay has no such problem: the log is replayed in a fixed
        // order and `reconstruct_state` below walks as far as stored deltas
        // allow, so a block whose selected parent is final is reconstructible
        // as long as the deltas back to the last fold point are present. During
        // replay the deltas are exactly what pruning manages, and the fold on
        // prune keeps every surviving block's delta complete, so gating here
        // would reject blocks that the log legitimately contains.
        //
        // Gating on replay would make a linearized-order log unloadable at any
        // non-trivial `finality_depth`: an anticone block ordered after the
        // chain has advanced past it has a final selected parent by
        // construction, and the genesis exemption below is only a special case
        // of that. Hence: no finality gate in replay mode.
        let sp = preview.selected_parent;
        let parent_score = self.dag.ghostdag(&sp).map_or(0, |g| g.blue_score);
        let finality_score = self.finality_score();
        if !self.replay_mode && parent_score < finality_score && sp != self.dag.genesis() {
            return Err(LedgerInsertError::Finality {
                parent_score,
                finality_score,
            });
        }

        // RFC-009 R7: a block may not build on history behind the finality
        // point — neither through a parent nor through a mergeset candidate.
        // This is the ledger-side twin of the DAG's block-pruning rejection
        // (`BuildsOnPrunedHistory`), evaluated against the finality point rather
        // than the config-dependent pruning point, so a pruning node and a
        // non-pruning node accept exactly the same blocks. It is also what makes
        // the bounded GHOSTDAG colouring exact under pruning (RFC-009 design
        // (A+), §14): a mergeset candidate in `anticone(P)` would otherwise be
        // coloured against an incomplete blue map.
        if !self.replay_mode {
            let finality_point = self.dag.lowest_block_at_or_above(finality_score);
            if finality_point != self.dag.genesis() {
                for x in block.parents().iter().chain(preview.mergeset.iter()) {
                    if *x != finality_point && !self.dag.is_ancestor(&finality_point, x) {
                        return Err(LedgerInsertError::Finality {
                            parent_score,
                            finality_score,
                        });
                    }
                }
            }
        }

        let parent_height = self.heights.get(&sp).copied().unwrap_or(0);
        let new_height = parent_height + 1;
        let block_blue_score = parent_score + 1;

        // Reconstruct the selected parent's view state from the undo log. The
        // finality check above guarantees `sp` is non-final (or is genesis,
        // whose delta is kept forever), so its delta is present and the
        // reconstruction succeeds.
        let mut state = self
            .reconstruct_state(&sp)
            .ok_or(LedgerInsertError::MissingParentDelta)?;
        let state_pre = state.clone();
        // RFC-006: the cumulative native minted in this block's view. Starts at
        // the selected parent's cumulative total (block_minted is cumulative),
        // then adds every mergeset coinbase that actually applies in this view
        // and finally the block's own coinbase. This is what gets persisted as
        // `block_minted[id]`, so `chain_minted_through(tip)` is O(1) and the
        // cap check below sees the true view total (mergeset coinbases included
        // — the oracle finding this fixes).
        let mut view_minted = self.chain_minted_through(sp);
        let mut view_fees = self.chain_fees_burned_through(sp);
        // Clone registry for mergeset application (speculative, won't commit if conflict)
        let mut asset_registry_merged = self.asset_registry.clone();
        for merged in &preview.mergeset {
            let merged_blue_score = self.dag.ghostdag(merged).map_or(0, |g| g.blue_score);
            // C1: the merged block's TRUE chain height, not blue score. The
            // batch path (apply_dag) computes chain heights by walking selected
            // parents from genesis; the incremental path must agree so every
            // mergeset coinbase gets the same creation_height (CSV/maturity
            // parity). The heights map is pruned for final blocks, so walk the
            // selected-parent chain from the merged block until a known height
            // is reached (mirroring apply_dag's height = sp_height + 1). Blue
            // score is only a last-resort fallback when the whole chain below
            // the finality boundary is pruned.
            let merged_height = self.chain_height_of(*merged).unwrap_or(merged_blue_score);
            let payload = self
                .dag
                .block(merged)
                .expect("mergeset block is in the DAG")
                .payload();
            if let Ok(merged_txs) = decode_block_payload(payload) {
                // A merged block that conflicts in this view simply does not
                // apply — its transactions were valid in their own view, not
                // necessarily here. This mirrors apply_dag's per-block reject.
                if let Ok(merged_summary) = apply_block_inner(
                    &mut state,
                    &mut asset_registry_merged,
                    &merged_txs,
                    self.schedule.subsidy_at(merged_height),
                    view_minted, // pass current cumulative for supply cap check
                    merged_height,
                    merged_blue_score,
                    self.multisig_activation_score,
                    self.native_token_activation_score,
                    self.stealth_activation_score,
                    self.script_v2_activation_score,
                    self.htlc_activation_score,
                    self.vault_activation_score,
                    self.mint_price_activation_score,
                    self.asset_logo_activation_score,
                ) {
                    view_minted = view_minted.saturating_add(merged_summary.minted);
                    // A2: each block contributes its OWN burn (fees - fees/4);
                    // the cumulative floor total - total/4 differs from the sum
                    // of per-block burns.
                    view_fees = view_fees.saturating_add(
                        merged_summary.fees - merged_summary.fees / FEE_PRODUCER_DEN,
                    );
                }
            }
        }

        // Stateful validation: the block's own transactions must be valid against
        // its view pre-state. Failure rejects the block before it enters the DAG.
        let summary = apply_block_inner(
            &mut state,
            &mut self.asset_registry,
            txs,
            self.schedule.subsidy_at(new_height),
            view_minted, // pass cumulative including mergeset for supply cap check
            new_height,
            block_blue_score,
            self.multisig_activation_score,
            self.native_token_activation_score,
            self.stealth_activation_score,
            self.script_v2_activation_score,
            self.htlc_activation_score,
            self.vault_activation_score,
            self.mint_price_activation_score,
            self.asset_logo_activation_score,
        )?;
        view_minted = view_minted.saturating_add(summary.minted);
        view_fees = view_fees.saturating_add(summary.fees - summary.fees / FEE_PRODUCER_DEN);

        // RFC-006 supply cap against the full view (selected-parent chain + mergeset + this block).
        if view_minted > MAX_SUPPLY {
            return Err(LedgerInsertError::State(LedgerError::SupplyCapExceeded {
                claimed: summary.minted,
                native_minted: view_minted.saturating_sub(summary.minted),
                max_supply: MAX_SUPPLY,
            }));
        }

        // Commit: add to the DAG (structural checks run here), then store the
        // block's net delta relative to its selected parent's view.
        let id = if self.replay_mode {
            self.dag.insert_for_replay(block, None)?
        } else {
            self.dag.insert(block)?
        };
        let delta = diff_utxo(&state_pre, &state);
        self.deltas.insert(id, delta);
        self.heights.insert(id, new_height);
        // Keep the selected-parent pointer independently of the DAG so delta
        // pruning and `reconstruct_state` survive block pruning (R7).
        self.selected_parents.insert(id, sp);
        // Cumulative view totals (selected-parent chain + mergeset + own).
        self.block_minted.insert(id, view_minted);
        self.block_fees.insert(id, view_fees);
        // Update asset registry with any newly minted assets from this block.
        self.update_asset_registry(txs, true);
        // The selected tip can only change to the block just inserted; when it
        // does, its state is the single materialised tip state.
        if self.dag.selected_tip() == id {
            self.tip_state = state;
            self.recompute_supply();
        }
        self.prune();
        Ok(id)
    }

    /// Drop the stored delta of every block that is now final (below
    /// [`Ledger::finality_score`]).
    ///
    /// A final block's delta is first **folded into every child** (a block
    /// whose selected parent it is): composing the deltas preserves the child's
    /// reconstruction exactly, and makes the child's delta relative to the
    /// empty set when the child's selected parent is final. Without this, a
    /// non-final side branch whose selected-parent chain crosses the finality
    /// boundary could not be reconstructed once the final blocks below it were
    /// dropped. Finality only rises, so a pruned block stays prunable; and only
    /// final blocks are dropped, which are never a future block's selected
    /// parent (that is a finality violation) nor needed by
    /// [`Ledger::ledger_state`] (which starts from the selected tip).
    pub(crate) fn prune(&mut self) {
        // During replay, we must not prune deltas because blocks later in the log
        // (e.g., anticone blocks linearized last) may have selected parents that
        // are currently final. Their deltas are needed for state reconstruction.
        // `prune_replay_final` is the mid-replay path that can prune safely,
        // because it is gated on a count of not-yet-replayed referrers rather
        // than on this blanket assumption.
        if self.replay_mode {
            return;
        }
        let threshold = self.finality_score();
        if threshold == 0 {
            return;
        }
        let mut stale: Vec<BlockId> = self
            .deltas
            .keys()
            .copied()
            // A block whose DAG entry is gone has been block-pruned. Block
            // pruning only ever evicts blocks at or below the finality point
            // (`block_pruning_depth >= finality_depth`), so such a block is
            // certainly final: treat it as stale. Without this, the evicted
            // block's delta would leak and `reconstruct_state` would walk into
            // a DAG entry that no longer exists (RFC-009 R7).
            .filter(|id| {
                self.dag
                    .ghostdag(id)
                    .map_or(true, |g| g.blue_score < threshold)
            })
            .collect();
        self.sort_by_height(&mut stale);
        for id in stale {
            self.prune_one(id);
        }
    }

    /// Prune during replay every block that is final **and** that no
    /// not-yet-replayed log record can still reference.
    ///
    /// `remaining[id]` is the number of log records that still name `id` as a
    /// parent and have not been replayed (see `LedgerStore`'s two-pass load).
    /// `remaining[id] == 0` is strictly stronger than "no child is currently in
    /// `self.deltas`": a record that has not been replayed yet is by definition
    /// absent from `deltas`, so only the caller's count can rule out a future
    /// block *selecting* `id` as its parent. That is what makes pruning
    /// mid-replay sound, where [`Ledger::prune`] can only refuse to prune at
    /// all.
    ///
    /// Folding is identical to [`Ledger::prune`]: the dropped block's delta is
    /// composed into each child's delta, so every child stays reconstructible
    /// from the empty set and a run of prunable blocks propagates one
    /// accumulated delta up to the first block that must be kept.
    pub(crate) fn prune_replay_final(&mut self, remaining: &HashMap<BlockId, usize>) {
        let threshold = self.finality_score();
        if threshold == 0 {
            return;
        }
        let mut stale: Vec<BlockId> = self
            .deltas
            .keys()
            .copied()
            .filter(|id| {
                remaining.get(id).copied().unwrap_or(0) == 0
                    && self
                        .dag
                        .ghostdag(id)
                        .is_some_and(|g| g.blue_score < threshold)
            })
            .collect();
        self.sort_by_height(&mut stale);
        for id in stale {
            self.prune_one(id);
        }
    }

    /// Order ids deepest-first (height ascending) so a chain of prunable blocks
    /// composes its accumulated delta up to the first block that is kept, rather
    /// than each block folding into a child that is itself about to be dropped.
    ///
    /// Height is used rather than blue score because a block-pruned (evicted)
    /// block has no DAG entry to read a blue score from, and is exactly the kind
    /// of block [`Self::prune`] must now order correctly. Heights are monotone
    /// along selected-parent edges (parent height < child height), which is the
    /// only property the deepest-first ordering needs.
    fn sort_by_height(&self, ids: &mut [BlockId]) {
        ids.sort_by_key(|id| self.heights.get(id).copied().unwrap_or(0));
    }

    /// Drop one block's delta, first composing it into every block that selects
    /// it as its selected parent.
    ///
    /// Dropping a delta without that composition is **not** a safe
    /// simplification: `reconstruct_state` rebuilds a block by applying the
    /// deltas along its selected-parent chain, so a child whose delta is still
    /// relative to a discarded parent silently loses that parent's effects.
    fn prune_one(&mut self, id: BlockId) {
        let Some(delta) = self.deltas.remove(&id) else {
            return;
        };
        // `id`'s own anchor: where its delta was relative to. Children are found
        // via the ledger's selected-parent pointer, not the DAG, because `id`
        // may already be block-pruned (RFC-009 R7).
        let anchor = self.selected_parents.remove(&id);
        let children: Vec<BlockId> = self
            .deltas
            .keys()
            .copied()
            .filter(|c| self.selected_parents.get(c) == Some(&id))
            .collect();
        for c in children {
            let child_delta = self.deltas.get_mut(&c).expect("child has a delta");
            *child_delta = compose_delta(&delta, child_delta);
            // `c`'s delta now includes `id`'s, so it is relative to `id`'s own
            // anchor: re-point (or clear) the pointer to keep it complete.
            match anchor {
                Some(a) => {
                    self.selected_parents.insert(c, a);
                }
                None => {
                    self.selected_parents.remove(&c);
                }
            }
        }
        self.heights.remove(&id);
    }

    /// The full current ledger state: every block applied in linearized order.
    ///
    /// Built incrementally as the selected tip's view state plus the side blocks
    /// under the other tips (the linearization's tail).
    pub fn ledger_state(&self) -> UtxoSet {
        let order = self.dag.linearize();
        let selected_tip = self.dag.selected_tip();
        let tip_pos = order
            .iter()
            .position(|b| *b == selected_tip)
            .expect("selected tip is in the order");

        let mut state = self.tip_state.clone();
        for block in &order[tip_pos + 1..] {
            let height = self.heights.get(block).copied().unwrap_or(0);
            let blue_score = self.dag.ghostdag(block).map_or(0, |g| g.blue_score);
            let payload = self
                .dag
                .block(block)
                .expect("block is in the DAG")
                .payload();
            if let Ok(txs) = decode_block_payload(payload) {
                let mut asset_registry_clone = self.asset_registry.clone();
                let _ = apply_block_inner(
                    &mut state,
                    &mut asset_registry_clone,
                    &txs,
                    self.schedule.subsidy_at(height),
                    0, // cumulative_minted
                    height,
                    blue_score,
                    self.multisig_activation_score,
                    self.native_token_activation_score,
                    self.stealth_activation_score,
                    self.script_v2_activation_score,
                    self.htlc_activation_score,
                    self.vault_activation_score,
                    self.mint_price_activation_score,
                    self.asset_logo_activation_score,
                );
            }
        }
        state
    }

    /// Serialise the ledger to a self-contained snapshot: the halving schedule plus the
    /// underlying DAG's replay log (see [`Dag::write_snapshot`]). Per-block UTXO
    /// state is *not* stored — it is recomputed on load by replaying blocks
    /// through [`Ledger::insert`], so nothing derived is trusted from disk.
    ///
    /// The snapshot also stores the runtime `finality_depth`,
    /// `payload_pruning_depth`, and `block_pruning_depth` so they are restored
    /// automatically (RFC-009 R8).
    ///
    /// # Errors
    ///
    /// Returns [`LedgerSnapshotError::BlockPruningUnsupported`] if the DAG has
    /// evicted any blocks. The replay-based format cannot represent a
    /// block-pruned DAG: a present block whose parent was evicted would fail to
    /// re-admit, and the evicted blocks' payloads are gone so their deltas could
    /// not be rebuilt. A pruning node must use the checkpoint or log tier.
    pub fn write_snapshot(&self) -> Result<Vec<u8>, LedgerSnapshotError> {
        if self.dag.pruning_point() != self.dag.genesis() {
            return Err(LedgerSnapshotError::BlockPruningUnsupported);
        }
        let mut buf = Vec::new();
        buf.extend_from_slice(&LEDGER_MAGIC);
        buf.extend_from_slice(&LEDGER_VERSION.to_le_bytes());
        buf.extend_from_slice(&self.schedule.genesis_subsidy.to_le_bytes());
        buf.extend_from_slice(&self.schedule.halving_era.to_le_bytes());
        buf.extend_from_slice(&self.finality_depth.to_le_bytes());
        buf.extend_from_slice(&self.payload_pruning_depth.to_le_bytes());
        buf.extend_from_slice(&self.block_pruning_depth.to_le_bytes());
        buf.extend_from_slice(&self.dag.write_snapshot());
        Ok(buf)
    }

    /// Rebuild a ledger from a snapshot by replaying its blocks. The full state
    /// (and each block's view state) is recomputed, so the restored ledger is
    /// identical to the original. The stored runtime policy — `finality_depth`,
    /// `payload_pruning_depth`, and `block_pruning_depth` — is restored too
    /// (RFC-009 R8); block pruning is applied *after* the replay so every block
    /// re-admits with its original id.
    ///
    /// For snapshots that contain **PoA blocks**, use
    /// [`Ledger::read_snapshot_with_poa`] — replay must run under the same
    /// admission rules that produced those ids.
    pub fn read_snapshot(bytes: &[u8]) -> Result<Ledger, LedgerSnapshotError> {
        Self::read_snapshot_impl(bytes, None)
    }

    /// Like [`Ledger::read_snapshot`], but Proof-of-Authority admission (with
    /// `authority_set` and `slot_duration_ms`) is active during replay, so PoA
    /// blocks re-admit with their original ids intact (the live `dag.insert`
    /// path enforces the authority signature; replay without the policy would
    /// reject them). Required for any snapshot produced in PoA mode.
    pub fn read_snapshot_with_poa(
        bytes: &[u8],
        authority_set: AuthoritySet,
        slot_duration_ms: u64,
    ) -> Result<Ledger, LedgerSnapshotError> {
        Self::read_snapshot_impl(bytes, Some((authority_set, slot_duration_ms)))
    }

    fn read_snapshot_impl(
        bytes: &[u8],
        poa: Option<(AuthoritySet, u64)>,
    ) -> Result<Ledger, LedgerSnapshotError> {
        if bytes.len() < 4 || bytes[..4] != LEDGER_MAGIC {
            return Err(LedgerSnapshotError::BadMagic);
        }
        if bytes.len() < 6 {
            return Err(LedgerSnapshotError::Dag(SnapshotError::UnexpectedEof));
        }
        let version = u16::from_le_bytes([bytes[4], bytes[5]]);
        // v2 = 38-byte header (magic + version + subsidy + era + finality_depth
        // + payload_pruning_depth); v3 appends `block_pruning_depth` (R8). A v2
        // snapshot is read with block pruning disabled, which is what it was
        // written with.
        if !(2..=LEDGER_VERSION).contains(&version) {
            return Err(LedgerSnapshotError::UnsupportedVersion(version));
        }
        let header_len = if version >= 3 { 46 } else { 38 };
        if bytes.len() < header_len {
            // magic(4) + version(2) + genesis_subsidy(8) + halving_era(8) + finality_depth(8)
            // + payload_pruning_depth(8) [+ block_pruning_depth(8)] = 38 (v2) or 46 (v3)
            return Err(LedgerSnapshotError::Dag(SnapshotError::UnexpectedEof));
        }
        let genesis_subsidy =
            u64::from_le_bytes(bytes[6..14].try_into().expect("14 - 6 == 8 bytes"));
        let halving_era = u64::from_le_bytes(bytes[14..22].try_into().expect("22 - 14 == 8 bytes"));
        let finality_depth =
            u64::from_le_bytes(bytes[22..30].try_into().expect("30 - 22 == 8 bytes"));
        let payload_pruning_depth =
            u64::from_le_bytes(bytes[30..38].try_into().expect("38 - 30 == 8 bytes"));
        let block_pruning_depth = if version >= 3 {
            u64::from_le_bytes(bytes[38..46].try_into().expect("46 - 38 == 8 bytes"))
        } else {
            u64::MAX
        };
        let schedule = HalvingSchedule::new(genesis_subsidy, halving_era);

        let snapshot = decode_snapshot(&bytes[header_len..]).map_err(LedgerSnapshotError::Dag)?;
        let mut blocks = snapshot.blocks.into_iter();
        let genesis = blocks.next().ok_or(LedgerSnapshotError::Empty)?;
        let genesis_txs =
            decode_block_payload(genesis.payload()).map_err(LedgerSnapshotError::Payload)?;
        let mut ledger = Ledger::new(snapshot.k, schedule, &genesis_txs)
            .map_err(LedgerSnapshotError::Genesis)?;
        ledger.finality_depth = finality_depth;
        ledger.payload_pruning_depth = payload_pruning_depth;
        ledger.dag.set_payload_pruning_depth(payload_pruning_depth);
        if let Some((authority_set, slot_duration_ms)) = poa {
            ledger.set_poa(authority_set, slot_duration_ms);
        }
        for block in blocks {
            // Identity-preserving replay: the snapshot's blocks must re-admit
            // with the exact ids their children reference. Block pruning is
            // deliberately left disabled during replay (R8); the policy is
            // applied to the fully-built DAG below.
            ledger
                .insert_raw_block(block)
                .map_err(LedgerSnapshotError::Rebuild)?;
        }
        // R8: restore the block-pruning policy *after* replay. Replaying under a
        // finite depth would evict blocks mid-rebuild; the snapshot is instead
        // reconstructed in full and the policy is then applied to the complete
        // DAG, exactly as a live node would after loading.
        ledger.set_block_pruning_depth(block_pruning_depth);
        Ok(ledger)
    }

    /// Serialise a **finality checkpoint**: the UTXO set at the finality boundary
    /// plus the blocks above it (the "tip segment"). On load, the checkpoint UTXO
    /// set is applied directly and only the tip segment is replayed, avoiding a
    /// full replay from genesis.
    ///
    /// The checkpoint is only meaningful when `finality_depth` is finite. If
    /// finality is disabled (`finality_depth == u64::MAX`), this returns an error.
    /// The checkpoint also stores the runtime `finality_depth` and
    /// `payload_pruning_depth` so they are restored automatically.
    pub fn write_checkpoint(&self) -> Result<Vec<u8>, LedgerCheckpointError> {
        if self.finality_depth == u64::MAX {
            return Err(LedgerCheckpointError::FinalityDisabled);
        }
        let finality_score = self.finality_score();
        let genesis_height = self.heights.get(&self.genesis).copied().unwrap_or(0);
        if finality_score == 0 && genesis_height == 0 {
            return Err(LedgerCheckpointError::FinalityNotActive);
        }

        // Find the checkpoint block: the highest block whose blue score is
        // >= finality_score but whose selected parent (if any) is below it.
        let order = self.dag.linearize();
        let mut checkpoint_block = self.genesis;
        for id in &order {
            let gd = self.dag.ghostdag(id).unwrap();
            if gd.blue_score >= finality_score {
                checkpoint_block = *id;
                break;
            }
        }

        // The checkpoint UTXO set is the state in the checkpoint block's view,
        // reconstructed from the undo log (the checkpoint block is non-final,
        // so its delta is present).
        let checkpoint_state = self
            .reconstruct_state(&checkpoint_block)
            .ok_or(LedgerCheckpointError::MissingCheckpointState)?;

        // The checkpoint block's height in the selected chain (for subsidy calculation).
        let checkpoint_height = self.heights.get(&checkpoint_block).copied().unwrap_or(0);

        // The tip segment: the checkpoint block plus blocks in linearized order
        // whose blue score is strictly above the finality score (i.e. not final).
        // The checkpoint block is included so it can serve as the trusted genesis
        // on restore, with its original ID preserved via Block::new_pruned*.
        let mut tip_segment = Vec::new();
        let cp_block = self
            .dag
            .block(&checkpoint_block)
            .expect("checkpoint block is present");
        let pruned_cp = kovanica_dag::Block::new_pruned_with_authority(
            cp_block.parents().to_vec(),
            cp_block.work(),
            cp_block.timestamp_ms(),
            cp_block.nonce(),
            cp_block.authority_sig().copied(),
            cp_block.id(),
        );
        tip_segment.push(pruned_cp);
        for id in &order {
            let gd = self.dag.ghostdag(id).unwrap();
            if gd.blue_score > finality_score {
                let block = self.dag.block(id).expect("linearized id is present");
                tip_segment.push(block.clone());
            }
        }

        let mut buf = Vec::new();
        buf.extend_from_slice(&CHECKPOINT_MAGIC);
        buf.extend_from_slice(&CHECKPOINT_VERSION.to_le_bytes());
        buf.extend_from_slice(&self.dag.k().to_le_bytes());
        buf.extend_from_slice(&self.schedule.genesis_subsidy.to_le_bytes());
        buf.extend_from_slice(&self.schedule.halving_era.to_le_bytes());
        buf.extend_from_slice(&self.finality_depth.to_le_bytes());
        buf.extend_from_slice(&self.payload_pruning_depth.to_le_bytes());
        buf.extend_from_slice(&checkpoint_height.to_le_bytes());
        buf.extend_from_slice(&checkpoint_state.encode());
        // v10: the length-prefixed stake registry blob (present in v3..=v9) is
        // no longer written — the stake registry retired with hybrid admission.
        // v8 (KVP-106): asset registry at the checkpoint block's view.
        let asset_registry_bytes = self.encode_asset_registry();
        buf.extend_from_slice(&(asset_registry_bytes.len() as u64).to_le_bytes());
        buf.extend_from_slice(&asset_registry_bytes);
        // Tip segment (checkpoint block + blocks above finality boundary)
        buf.extend_from_slice(&(tip_segment.len() as u64).to_le_bytes());
        for block in &tip_segment {
            kovanica_dag::encode_block(block, &mut buf);
        }
        // v7: supply counters at the live tip (not only the checkpoint block).
        buf.extend_from_slice(&self.native_minted.to_le_bytes());
        buf.extend_from_slice(&self.fees_burned.to_le_bytes());
        Ok(buf)
    }

    /// Rebuild a ledger from a finality checkpoint. Applies the checkpoint UTXO
    /// set directly, then replays only the tip segment blocks (those above the
    /// finality boundary). Returns the restored ledger with the same
    /// `finality_depth` and `payload_pruning_depth` as when the checkpoint was
    /// written.
    ///
    /// For checkpoints whose tip segment contains PoA blocks, use
    /// [`Ledger::read_checkpoint_with_poa`].
    pub fn read_checkpoint(bytes: &[u8]) -> Result<Ledger, LedgerCheckpointError> {
        Self::read_checkpoint_impl(bytes, None)
    }

    /// Like [`Ledger::read_checkpoint`], but Proof-of-Authority admission runs
    /// during tip-segment replay so PoA blocks keep their original ids.
    pub fn read_checkpoint_with_poa(
        bytes: &[u8],
        authority_set: AuthoritySet,
        slot_duration_ms: u64,
    ) -> Result<Ledger, LedgerCheckpointError> {
        Self::read_checkpoint_impl(bytes, Some((authority_set, slot_duration_ms)))
    }

    fn read_checkpoint_impl(
        bytes: &[u8],
        poa: Option<(AuthoritySet, u64)>,
    ) -> Result<Ledger, LedgerCheckpointError> {
        if bytes.len() < 4 || bytes[..4] != CHECKPOINT_MAGIC {
            return Err(LedgerCheckpointError::BadMagic);
        }
        let min_header = 4 + 2 + 2 + 8 + 8 + 8 + 8 + 8; // magic + version + k + 5*u64
        if bytes.len() < min_header {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        let version = u16::from_le_bytes([bytes[4], bytes[5]]);
        // Accept v3 (stake registry), v4 (asset_id in UTXO), v5 (stealth ext),
        // v6 (per-entry creation height — RFC-005 CSV), v7 (is_coinbase +
        // supply counters), v8 (asset registry), and v9 (authority-signature
        // flag byte in tip-segment blocks). v3..=v9 still carry the retired stake
        // registry blob, which is read and discarded.
        if !(3..=CHECKPOINT_VERSION).contains(&version) {
            return Err(LedgerCheckpointError::UnsupportedVersion(version));
        }
        let mut pos = 6;
        let k = u16::from_le_bytes(bytes[pos..pos + 2].try_into().unwrap());
        pos += 2;
        let genesis_subsidy = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap());
        pos += 8;
        let halving_era = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap());
        pos += 8;
        let finality_depth = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap());
        pos += 8;
        let payload_pruning_depth = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap());
        pos += 8;
        let checkpoint_height = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap());
        pos += 8;

        // Decode checkpoint UTXO set.
        // v5-: no creation_height, no coinbase flag
        // v6: creation_height, no coinbase flag
        // v7+: creation_height + is_coinbase
        let mut remaining = &bytes[pos..];
        let checkpoint_state = if version <= 5 {
            UtxoSet::decode_v5(&mut remaining)
        } else if version == 6 {
            UtxoSet::decode_v6(&mut remaining)
        } else {
            UtxoSet::decode(&mut remaining)
        }
        .map_err(|_| LedgerCheckpointError::Payload(DecodeError::UnexpectedEof))?;
        pos = bytes.len() - remaining.len();

        // v3..=v9: a length-prefixed stake registry blob followed the UTXO set.
        // The stake registry retired with hybrid admission, so v10 no longer
        // writes it — but legacy checkpoints still decode, so the blob is
        // consumed and discarded here (same posture as the reserved VRF byte).
        //
        // `pos + len` is computed with `checked_add` throughout: a corrupt or
        // hostile length prefix must be an error, never an overflow panic.
        if version < 10 {
            let Some(next) = pos.checked_add(8) else {
                return Err(LedgerCheckpointError::UnexpectedEof);
            };
            if bytes.len() < next {
                return Err(LedgerCheckpointError::UnexpectedEof);
            }
            let stake_len = u64::from_le_bytes(bytes[pos..next].try_into().unwrap()) as usize;
            pos = next;
            let Some(end) = pos.checked_add(stake_len) else {
                return Err(LedgerCheckpointError::UnexpectedEof);
            };
            if bytes.len() < end {
                return Err(LedgerCheckpointError::UnexpectedEof);
            }
            pos = end;
        }

        // v8 (KVP-106): asset registry blob (for version >= 8).
        let checkpoint_asset_registry = if version >= 8 {
            let Some(next) = pos.checked_add(8) else {
                return Err(LedgerCheckpointError::UnexpectedEof);
            };
            if bytes.len() < next {
                return Err(LedgerCheckpointError::UnexpectedEof);
            }
            let asset_reg_len = u64::from_le_bytes(bytes[pos..next].try_into().unwrap()) as usize;
            pos = next;
            let Some(end) = pos.checked_add(asset_reg_len) else {
                return Err(LedgerCheckpointError::UnexpectedEof);
            };
            if bytes.len() < end {
                return Err(LedgerCheckpointError::UnexpectedEof);
            }
            pos = end;
            let mut reader = CheckpointReader::new(&bytes[pos - asset_reg_len..pos]);
            let mut registry = HashMap::new();
            let count = reader.read_u64()? as usize;
            for _ in 0..count {
                let asset_id = AssetId::from_bytes(reader.read_array::<32>()?);
                let kind_byte = reader.read_u8()?;
                let kind = match kind_byte {
                    0 => AssetKind::Fungible,
                    1 => AssetKind::NonFungible,
                    _ => return Err(LedgerCheckpointError::BadAssetKind),
                };
                let max_supply = reader.read_u64()?;
                let minted = reader.read_u64()?;
                let metadata_hash = if reader.read_u8()? == 1 {
                    Some(reader.read_array::<32>()?)
                } else {
                    None
                };
                let collection_id = if reader.read_u8()? == 1 {
                    Some(reader.read_array::<32>()?)
                } else {
                    None
                };
                let creator = if reader.read_u8()? == 1 {
                    Some(reader.read_array::<32>()?)
                } else {
                    None
                };
                // v11+ fields (mint_price_per_unit, logo_uri, metadata_uri) default for old checkpoints
                let mint_price_per_unit = if version >= 11 { reader.read_u64()? } else { 0 };
                let logo_uri = if version >= 11 && reader.read_u8()? == 1 {
                    let scheme_byte = reader.read_u8()?;
                    let scheme = LogoScheme::from_u8(scheme_byte)
                        .ok_or(LedgerCheckpointError::BadAssetKind)?;
                    let content_hash = reader.read_array::<32>()?;
                    let uri_len = reader.read_u64()? as usize;
                    let uri_bytes = reader.read_bytes(uri_len)?;
                    let uri = String::from_utf8(uri_bytes)
                        .map_err(|_| LedgerCheckpointError::BadAssetKind)?;
                    Some(LogoUri {
                        scheme,
                        content_hash,
                        uri,
                    })
                } else {
                    None
                };
                let metadata_uri = if version >= 11 && reader.read_u8()? == 1 {
                    let scheme_byte = reader.read_u8()?;
                    let scheme = MetadataScheme::from_u8(scheme_byte)
                        .ok_or(LedgerCheckpointError::BadAssetKind)?;
                    let content_hash = reader.read_array::<32>()?;
                    let uri_len = reader.read_u64()? as usize;
                    let uri_bytes = reader.read_bytes(uri_len)?;
                    let uri = String::from_utf8(uri_bytes)
                        .map_err(|_| LedgerCheckpointError::BadAssetKind)?;
                    Some(MetadataUri {
                        scheme,
                        content_hash,
                        uri,
                    })
                } else {
                    None
                };
                registry.insert(
                    asset_id,
                    AssetRegistryEntry {
                        asset_id,
                        kind,
                        max_supply,
                        minted,
                        metadata_hash,
                        collection_id,
                        creator,
                        mint_price_per_unit,
                        logo_uri,
                        metadata_uri,
                    },
                );
            }
            Some(registry)
        } else {
            None
        };

        if bytes.len() < pos + 8 {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        let tip_count = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap()) as usize;
        pos += 8;

        let schedule = HalvingSchedule::new(genesis_subsidy, halving_era);

        // Read tip segment blocks (each encoded with kovanica_dag::encode_block)
        // The first block is the checkpoint block; we must reconstruct it with
        // its original ID using Block::new_pruned.
        let mut blocks = Vec::new();
        let mut block_pos = pos;
        for i in 0..tip_count {
            if block_pos + 32 > bytes.len() {
                return Err(LedgerCheckpointError::UnexpectedEof);
            }
            // Read the stored block ID (first 32 bytes of encode_block output)
            let stored_id =
                BlockId::from_bytes(bytes[block_pos..block_pos + 32].try_into().unwrap());
            block_pos += 32;
            let (mut block, consumed) = decode_checkpoint_block(&bytes[block_pos..], version)?;
            block_pos += consumed;

            // For the first block (checkpoint block), reconstruct with original ID
            if i == 0 {
                block = Block::new_pruned(
                    block.parents().to_vec(),
                    block.work(),
                    block.timestamp_ms(),
                    block.nonce(),
                    stored_id,
                );
            }
            blocks.push(block);
        }

        // v7: trailing supply counters (tip values at write time).
        let (stored_minted, stored_burned) = if version >= 7 {
            if bytes.len() < block_pos + 16 {
                return Err(LedgerCheckpointError::UnexpectedEof);
            }
            let minted = u64::from_le_bytes(bytes[block_pos..block_pos + 8].try_into().unwrap());
            let burned =
                u64::from_le_bytes(bytes[block_pos + 8..block_pos + 16].try_into().unwrap());
            (Some(minted), Some(burned))
        } else {
            (None, None)
        };

        // The first block in tip_segment is the checkpoint block; use it as genesis.
        let mut blocks_iter = blocks.into_iter();
        let checkpoint_block = blocks_iter
            .next()
            .ok_or(LedgerCheckpointError::UnexpectedEof)?;

        // Create DAG with checkpoint block as genesis (trusted, bypasses parent check).
        // The checkpoint block may have parents that don't exist in the restored DAG;
        // we trust it as the finality boundary.
        let checkpoint_id = checkpoint_block.id();
        let mut dag = Dag::with_validator(k, checkpoint_block, Box::new(TxStructureValidator));
        dag.set_payload_pruning_depth(payload_pruning_depth);

        // Build ledger with the checkpoint state applied directly: it becomes
        // the materialised tip state, and the checkpoint block's delta is
        // relative to the empty set (it is the trusted genesis of the restored
        // ledger), so its view state reconstructs to exactly the checkpoint.
        let checkpoint_delta = diff_utxo(&UtxoSet::new(), &checkpoint_state);
        let mut ledger = Ledger {
            dag,
            schedule,
            genesis: checkpoint_id,
            finality_depth,
            payload_pruning_depth,
            // Checkpoint format does not persist the block-pruning policy
            // (RFC-008: format unchanged); it starts disabled and the caller
            // re-applies its profile depth via `set_block_pruning_depth`.
            block_pruning_depth: u64::MAX,
            tip_state: checkpoint_state,
            asset_registry: checkpoint_asset_registry.unwrap_or_default(),
            deltas: HashMap::new(),
            poa: None,
            heights: HashMap::new(),
            selected_parents: HashMap::new(),
            multisig_activation_score: MULTISIG_ACTIVATION_SCORE,
            native_token_activation_score: NATIVE_TOKEN_ACTIVATION_SCORE,
            stealth_activation_score: STEALTH_ACTIVATION_SCORE,
            script_v2_activation_score: SCRIPT_V2_ACTIVATION_SCORE,
            htlc_activation_score: HTLC_ACTIVATION_SCORE,
            vault_activation_score: VAULT_ACTIVATION_SCORE,
            mint_price_activation_score: MINT_PRICE_ACTIVATION_SCORE,
            asset_logo_activation_score: ASSET_LOGO_ACTIVATION_SCORE,
            native_minted: stored_minted.unwrap_or(0),
            fees_burned: stored_burned.unwrap_or(0),
            block_minted: HashMap::new(),
            block_fees: HashMap::new(),
            replay_mode: false,
        };
        ledger.deltas.insert(checkpoint_id, checkpoint_delta);
        ledger.heights.insert(checkpoint_id, checkpoint_height);
        if let Some((authority_set, slot_duration_ms)) = poa {
            ledger.set_poa(authority_set, slot_duration_ms);
        }

        // Replay remaining tip segment blocks (those strictly above finality).
        for block in blocks_iter {
            let txs =
                decode_block_payload(block.payload()).map_err(LedgerCheckpointError::Payload)?;
            let mapped_parents: Vec<_> = block
                .parents()
                .iter()
                .map(|p| {
                    if ledger.dag().ghostdag(p).is_some() {
                        *p
                    } else {
                        checkpoint_id
                    }
                })
                .collect();
            // Preserve the PoA authority signature through the rewind; only
            // parents are remapped (a block whose parents were rewired
            // legitimately gets a new id — pre-existing checkpoint semantics).
            // Without this the rebuilt block would lose its authority sig and
            // be rejected by PoA admission on the way back in.
            let rebuilt = match block.authority_sig() {
                Some(sig) => Block::new_with_authority(
                    mapped_parents,
                    block.work(),
                    block.timestamp_ms(),
                    block.nonce(),
                    *sig,
                    block.payload().to_vec(),
                ),
                None => Block::new(
                    mapped_parents,
                    block.work(),
                    block.timestamp_ms(),
                    block.nonce(),
                    block.payload().to_vec(),
                ),
            };
            ledger
                .insert_prepared_block(rebuilt, &txs)
                .map_err(LedgerCheckpointError::Rebuild)?;
        }

        // Authoritative supply from checkpoint (v7+). The stored values are the
        // LIVE TIP's totals at write time, but the tip-segment replay above
        // computed cumulative values starting from 0 at the checkpoint block
        // (its pre-checkpoint history is pruned, so block_minted[checkpoint_id]
        // was never set). Reconcile: the checkpoint block's view totals are the
        // stored totals minus the tip segment's own contribution. Add that base
        // to every replayed block's cumulative entry so the maps are continuous
        // and a new block after restore computes view_minted = stored_total +
        // own (A1 — previously the first post-restore block collapsed the
        // supply counters to just its own contribution).
        if let (Some(m), Some(b)) = (stored_minted, stored_burned) {
            let tip = ledger.dag.selected_tip();
            let replayed_minted = ledger.block_minted.get(&tip).copied().unwrap_or(0);
            let replayed_burn = ledger.block_fees.get(&tip).copied().unwrap_or(0);
            let base_minted = m.saturating_sub(replayed_minted);
            let base_burn = b.saturating_sub(replayed_burn);
            for v in ledger.block_minted.values_mut() {
                *v = v.saturating_add(base_minted);
            }
            for v in ledger.block_fees.values_mut() {
                *v = v.saturating_add(base_burn);
            }
            // The checkpoint block itself (the restored genesis) carries the
            // base totals; it was never inserted through the replay path.
            ledger.block_minted.insert(checkpoint_id, base_minted);
            ledger.block_fees.insert(checkpoint_id, base_burn);
            ledger.native_minted = m;
            ledger.fees_burned = b;
        } else {
            // Legacy: approximate from checkpoint UTXO value only.
            ledger.native_minted =
                ledger.tip_state.total_value().min(u128::from(MAX_SUPPLY)) as u64;
            ledger.fees_burned = 0;
        }

        Ok(ledger)
    }
}

/// RFC-006 genesis coinbase: founder premine + RFC006_TREASURY_TRANCHES x1M treasury vaults.
///
/// Treasury keys are derived from `treasury_seed` (32 bytes) if provided:
/// `BLAKE3(seed || "treasury" || k)` — not derivable without the seed.
///
/// If `treasury_seed` is `None`, the **placeholder** keys are used:
/// `KeyPair::from_u64(TREASURY_SEED_BASE + k)`. These are **TESTNET-ONLY and
/// publicly derivable by design** — anyone can compute them from the public
/// constant, so they must NEVER hold real funds. Production MUST pass a real
/// secret seed via key ceremony; the placeholder path exists solely to keep
/// the live testnet genesis (9565fc20…) reproducible.
///
/// Tranche k unlocks at height `k * BLOCKS_PER_YEAR`.
pub fn rfc006_genesis_coinbase(founder: Address, treasury_seed: Option<[u8; 32]>) -> Transaction {
    let mut outputs = Vec::with_capacity(1 + RFC006_TREASURY_TRANCHES as usize);
    outputs.push(TxOutput::native(RFC006_PREMINE, founder));
    for k in 1..=RFC006_TREASURY_TRANCHES {
        let unlock_height = k.saturating_mul(BLOCKS_PER_YEAR);
        let owner_pk = if let Some(seed) = treasury_seed {
            // Derive key from secret seed: BLAKE3(seed || "treasury" || k)
            let mut hasher = blake3::Hasher::new();
            hasher.update(&seed);
            hasher.update(b"treasury");
            hasher.update(&k.to_le_bytes());
            let derived = hasher.finalize();
            *KeyPair::from_seed(*derived.as_bytes()).address().payload()
        } else {
            // Placeholder (TESTNET-ONLY): publicly derivable by design so the
            // live testnet genesis stays reproducible. Never use for real funds.
            *KeyPair::from_u64(u64::from(TREASURY_SEED_BASE + k))
                .address()
                .payload()
        };
        let vault = VaultScript::new(unlock_height, 0, owner_pk)
            .expect("treasury vault template is well-formed");
        outputs.push(TxOutput::native(RFC006_TREASURY_TRANCHE, vault.address()));
    }
    Transaction::coinbase(outputs, b"genesis-rfc006".to_vec())
}

/// The RFC-POA genesis coinbase tag committing to the authority set:
/// `KVA1 || authority_set_hash` (RFC-POA §1).
///
/// The genesis coinbase's tag is part of the coinbase transaction id, which is
/// part of the genesis block payload — so the genesis block id commits to the
/// authority set. SPV/light clients verify the set they are told about against
/// the genesis they sync from, and a node configured with a different set
/// derives a different genesis id (a hard fork marker, not a silent mismatch).
pub fn poa_genesis_tag(set_hash: &[u8; 32]) -> Vec<u8> {
    let mut tag = kovanica_dag::AUTHORITY_UTXO_TAG.to_vec();
    tag.extend_from_slice(set_hash);
    tag
}

/// Parse an RFC-POA genesis coinbase tag into its authority-set hash, or
/// `None` if `tag` is not a well-formed `KVA1 || hash` tag.
pub fn parse_poa_genesis_tag(tag: &[u8]) -> Option<[u8; 32]> {
    let prefix = kovanica_dag::AUTHORITY_UTXO_TAG;
    if tag.len() != prefix.len() + 32 || !tag.starts_with(prefix) {
        return None;
    }
    tag[prefix.len()..].try_into().ok()
}

/// Derive the placeholder treasury public key for tranche `k` (1-based).
///
/// This matches the derivation used when `treasury_seed = None` in
/// [`rfc006_genesis_coinbase`]. Exposed for testing and verification.
///
/// ⚠️ TESTNET-ONLY: these keys are **publicly derivable by design**
/// (`KeyPair::from_u64(TREASURY_SEED_BASE + k)` — anyone can compute them).
/// Do not use them for real funds; production must pass a real secret seed.
pub fn placeholder_treasury_key(k: u32) -> [u8; 32] {
    *KeyPair::from_u64(u64::from(TREASURY_SEED_BASE + k))
        .address()
        .payload()
}

/// Decode a single block from the checkpoint tip segment format.
/// Returns the block and the number of bytes consumed.
///
/// `version` is the checkpoint format version: v9+ blocks carry the
/// authority-signature flag byte (matching `kovanica_dag::encode_block`);
/// v8 and earlier do not.
fn decode_checkpoint_block(
    bytes: &[u8],
    version: u16,
) -> Result<(Block, usize), LedgerCheckpointError> {
    // Blocks in checkpoint are stored using kovanica_dag::encode_block format
    // (without the DAG magic/version header, just the block data).
    // The format: parents_len + parents + work + timestamp_ms + nonce + payload_len + payload
    let mut reader = CheckpointReader::new(bytes);
    let n_parents = reader.read_count(32)? as usize;
    let mut parents = Vec::with_capacity(n_parents);
    for _ in 0..n_parents {
        if reader.remaining() < 32 {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        parents.push(BlockId::from_bytes(reader.read_array::<32>()?));
    }
    let work = reader.read_u128()?;
    let timestamp_ms = reader.read_u64()?;
    let nonce = reader.read_u64()?;

    // Reserved `has_vrf` byte: VRF is removed, and `kovanica_dag::encode_block`
    // still emits one zero byte there, so it MUST be consumed here to stay
    // byte-aligned. Legacy (v6..=v9) checkpoints that were written while VRF
    // was live may carry a 1 plus the proof/output tails — those are skipped
    // without being interpreted, so the reader still lands on the right offset
    // (same "skip legacy" posture as the retired stake blob).
    let has_vrf = reader.read_u8()?;
    if has_vrf == 1 {
        // vrf_public_key (32B), proof_flag (1B) [+ 96B proof], output_flag
        // (1B) [+ 32B output].
        reader.skip(32)?;
        if reader.read_u8()? == 1 {
            reader.skip(96)?;
        }
        if reader.read_u8()? == 1 {
            reader.skip(32)?;
        }
    }

    // Authority signature (PoA, v9+): has_auth flag (1 byte), then if set:
    // authority_sig (64 bytes). The checkpoint block itself never carries one
    // (it is reconstructed via `Block::new_pruned`), but tip-segment blocks do
    // — they are re-inserted and must pass PoA admission again, so the
    // signature is preserved.
    let authority_sig = if version >= 9 {
        let has_auth = reader.read_u8()?;
        if has_auth == 1 {
            Some(reader.read_array::<64>()?)
        } else {
            None
        }
    } else {
        None
    };

    let payload_len = reader.read_count(1)? as usize;
    if payload_len == 0 {
        let block = Block::new_pruned_with_authority(
            parents,
            work,
            timestamp_ms,
            nonce,
            authority_sig,
            BlockId::from_bytes([0u8; 32]),
        );
        let consumed = reader.pos;
        return Ok((block, consumed));
    }
    if reader.remaining() < payload_len {
        return Err(LedgerCheckpointError::UnexpectedEof);
    }
    let payload = reader.read_bytes(payload_len)?;
    let block = match authority_sig {
        Some(sig) => Block::new_with_authority(parents, work, timestamp_ms, nonce, sig, payload),
        None => Block::new(parents, work, timestamp_ms, nonce, payload),
    };
    let consumed = reader.pos;
    Ok((block, consumed))
}

/// Local reader for checkpoint block decoding.
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

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], LedgerCheckpointError> {
        if self.remaining() < N {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.buf[self.pos..self.pos + N]);
        self.pos += N;
        Ok(out)
    }

    fn read_u8(&mut self) -> Result<u8, LedgerCheckpointError> {
        let b = self.read_array::<1>()?;
        Ok(b[0])
    }

    fn read_u64(&mut self) -> Result<u64, LedgerCheckpointError> {
        Ok(u64::from_le_bytes(self.read_array::<8>()?))
    }
    fn read_u128(&mut self) -> Result<u128, LedgerCheckpointError> {
        Ok(u128::from_le_bytes(self.read_array::<16>()?))
    }
    fn read_count(&mut self, min_element_bytes: usize) -> Result<u64, LedgerCheckpointError> {
        let n = self.read_u64()? as usize;
        if min_element_bytes > 0 && n > self.remaining() / min_element_bytes {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        Ok(n as u64)
    }
    fn read_bytes(&mut self, len: usize) -> Result<Vec<u8>, LedgerCheckpointError> {
        if self.remaining() < len {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        let out = self.buf[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(out)
    }

    /// Advance the cursor by `len` bytes without interpreting them. Used to
    /// stay byte-aligned across payload slots that are read but no longer
    /// meaningful (the retired VRF tail).
    fn skip(&mut self, len: usize) -> Result<(), LedgerCheckpointError> {
        if self.remaining() < len {
            return Err(LedgerCheckpointError::UnexpectedEof);
        }
        self.pos += len;
        Ok(())
    }
}

impl Ledger {
    /// Encode the asset registry for checkpoint serialization.
    fn encode_asset_registry(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(self.asset_registry.len() as u64).to_le_bytes());
        for (asset_id, entry) in &self.asset_registry {
            buf.extend_from_slice(asset_id.as_bytes());
            // kind: 0 = Fungible, 1 = NonFungible
            buf.push(match entry.kind {
                AssetKind::Fungible => 0,
                AssetKind::NonFungible => 1,
            });
            buf.extend_from_slice(&entry.max_supply.to_le_bytes());
            buf.extend_from_slice(&entry.minted.to_le_bytes());
            // mint_price_per_unit (v11+): u64
            buf.extend_from_slice(&entry.mint_price_per_unit.to_le_bytes());
            // metadata_hash: 0 = none, 1 = present + 32 bytes
            if let Some(hash) = entry.metadata_hash {
                buf.push(1);
                buf.extend_from_slice(&hash);
            } else {
                buf.push(0);
            }
            // collection_id: 0 = none, 1 = present + 32 bytes
            if let Some(cid) = entry.collection_id {
                buf.push(1);
                buf.extend_from_slice(&cid);
            } else {
                buf.push(0);
            }
            // creator: 0 = none, 1 = present + 32 bytes
            if let Some(pk) = entry.creator {
                buf.push(1);
                buf.extend_from_slice(&pk);
            } else {
                buf.push(0);
            }
            // logo_uri (v11+): 0 = none, 1 = present
            if let Some(logo) = &entry.logo_uri {
                buf.push(1);
                buf.push(logo.scheme.to_u8());
                buf.extend_from_slice(&logo.content_hash);
                buf.extend_from_slice(&(logo.uri.len() as u64).to_le_bytes());
                buf.extend_from_slice(logo.uri.as_bytes());
            } else {
                buf.push(0);
            }
            // metadata_uri (v11+): 0 = none, 1 = present
            if let Some(meta) = &entry.metadata_uri {
                buf.push(1);
                buf.push(meta.scheme.to_u8());
                buf.extend_from_slice(&meta.content_hash);
                buf.extend_from_slice(&(meta.uri.len() as u64).to_le_bytes());
                buf.extend_from_slice(meta.uri.as_bytes());
            } else {
                buf.push(0);
            }
        }
        buf
    }
}

/// Magic prefix identifying a Kovanica ledger checkpoint (`"KVCP"`).
const CHECKPOINT_MAGIC: [u8; 4] = *b"KVCP";
/// Checkpoint format version. v2 adds checkpoint block height; v3 adds the
/// length-prefixed stake registry of the checkpoint block's view; v4 adds
/// optional asset_id to UTXO encoding; v5 adds the optional stealth extension
/// (R + view_tag + P) to UTXO encoding so stealth outputs survive a checkpoint
/// round-trip.
/// v7 (RFC-006): UTXO entries carry `is_coinbase`; trailing native_minted + fees_burned.
/// v8 (KVP-106): asset registry appended after stake registry.
/// v9 (PoA): tip-segment blocks are encoded with `kovanica_dag::encode_block`,
/// which now writes the authority-signature flag byte (0 = absent) after the
/// (now reserved) VRF byte. v8 and earlier checkpoints (no flag byte) still decode.
/// v10 (PoA-only): the stake registry retired with hybrid admission and is no
/// longer written; v3..=v9 checkpoints still decode (the blob is read and
/// discarded). This is a consensus-breaking change — old readers cannot read
/// v10.
/// v11 (KVP-107): asset registry entries include mint_price_per_unit, logo_uri,
/// and metadata_uri. v3..=v10 checkpoints still decode (new fields default to 0/None).
const CHECKPOINT_VERSION: u16 = 11;

/// Why a ledger checkpoint could not be encoded or decoded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LedgerCheckpointError {
    /// The bytes did not start with the expected magic prefix.
    BadMagic,
    /// The checkpoint version is not supported by this build.
    UnsupportedVersion(u16),
    /// The input ended before a fully-formed value could be read.
    UnexpectedEof,
    /// Bytes remained after the declared number of entries.
    TrailingBytes,
    /// Finality is disabled (unbounded), so no checkpoint can be written.
    FinalityDisabled,
    /// Finality depth is set but the DAG isn't deep enough yet.
    FinalityNotActive,
    /// The checkpoint block's state is missing (should not happen).
    MissingCheckpointState,
    /// A block's payload was not valid transaction encoding.
    Payload(DecodeError),
    /// The embedded DAG block could not be decoded.
    Dag(SnapshotError),
    /// Applying the genesis transactions failed.
    Genesis(LedgerError),
    /// Replaying a block through `insert` failed.
    Rebuild(LedgerInsertError),
    /// The checkpoint state at the boundary does not match the replayed state.
    StateMismatch,
    /// Invalid asset kind byte in asset registry (v8+).
    BadAssetKind,
}

impl core::fmt::Display for LedgerCheckpointError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            LedgerCheckpointError::BadMagic => f.write_str("not a kovanica ledger checkpoint"),
            LedgerCheckpointError::UnsupportedVersion(v) => {
                write!(f, "unsupported checkpoint version {v}")
            }
            LedgerCheckpointError::UnexpectedEof => f.write_str("unexpected end of checkpoint"),
            LedgerCheckpointError::TrailingBytes => f.write_str("trailing bytes after checkpoint"),
            LedgerCheckpointError::FinalityDisabled => {
                f.write_str("cannot checkpoint: finality is disabled (unbounded)")
            }
            LedgerCheckpointError::FinalityNotActive => {
                f.write_str("cannot checkpoint: DAG not deep enough for finality")
            }
            LedgerCheckpointError::MissingCheckpointState => {
                f.write_str("checkpoint block state missing")
            }
            LedgerCheckpointError::Payload(e) => write!(f, "payload decode: {e}"),
            LedgerCheckpointError::Dag(e) => write!(f, "dag block: {e}"),
            LedgerCheckpointError::Genesis(e) => write!(f, "genesis: {e}"),
            LedgerCheckpointError::Rebuild(e) => write!(f, "replaying block: {e}"),
            LedgerCheckpointError::StateMismatch => {
                f.write_str("checkpoint state mismatch at boundary")
            }
            LedgerCheckpointError::BadAssetKind => {
                f.write_str("invalid asset kind in asset registry")
            }
        }
    }
}

impl std::error::Error for LedgerCheckpointError {}

impl From<DecodeError> for LedgerCheckpointError {
    fn from(e: DecodeError) -> Self {
        LedgerCheckpointError::Payload(e)
    }
}

impl From<SnapshotError> for LedgerCheckpointError {
    fn from(e: SnapshotError) -> Self {
        LedgerCheckpointError::Dag(e)
    }
}

impl From<LedgerError> for LedgerCheckpointError {
    fn from(e: LedgerError) -> Self {
        LedgerCheckpointError::Genesis(e)
    }
}

impl From<LedgerInsertError> for LedgerCheckpointError {
    fn from(e: LedgerInsertError) -> Self {
        LedgerCheckpointError::Rebuild(e)
    }
}

/// Magic prefix identifying a Kovanica ledger snapshot (`"KVLG"`).
const LEDGER_MAGIC: [u8; 4] = *b"KVLG";
/// Ledger snapshot format version. v2 added `finality_depth` and
/// `payload_pruning_depth`; v3 added `block_pruning_depth`.
const LEDGER_VERSION: u16 = 3;

/// Why a ledger snapshot could not be decoded or replayed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LedgerSnapshotError {
    /// The bytes did not start with the expected magic prefix.
    BadMagic,
    /// The snapshot version is not supported by this build.
    UnsupportedVersion(u16),
    /// The embedded DAG snapshot could not be decoded.
    Dag(SnapshotError),
    /// A block's payload was not valid transaction encoding.
    Payload(DecodeError),
    /// Applying the genesis transactions failed.
    Genesis(LedgerError),
    /// Replaying a block through `insert` failed.
    Rebuild(LedgerInsertError),
    /// The snapshot contained no genesis block.
    Empty,
    /// The DAG has evicted blocks, which the replay-based snapshot cannot
    /// represent (RFC-009 R8). Use the checkpoint or log tier instead.
    BlockPruningUnsupported,
}

impl core::fmt::Display for LedgerSnapshotError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            LedgerSnapshotError::BadMagic => f.write_str("not a kovanica ledger snapshot"),
            LedgerSnapshotError::UnsupportedVersion(v) => {
                write!(f, "unsupported ledger snapshot version {v}")
            }
            LedgerSnapshotError::Dag(e) => write!(f, "dag snapshot: {e}"),
            LedgerSnapshotError::Payload(e) => write!(f, "payload decode: {e}"),
            LedgerSnapshotError::Genesis(e) => write!(f, "genesis: {e}"),
            LedgerSnapshotError::Rebuild(e) => write!(f, "replaying block: {e}"),
            LedgerSnapshotError::Empty => f.write_str("snapshot has no genesis block"),
            LedgerSnapshotError::BlockPruningUnsupported => f.write_str(
                "snapshot cannot represent a block-pruned DAG; use the checkpoint or log tier",
            ),
        }
    }
}

impl std::error::Error for LedgerSnapshotError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KeyPair;
    use crate::tx::{TxId, TxOutput};

    // A funded outpoint owned by `kp`, seeded directly into a UTXO set so unit
    // tests need no coinbase plumbing.
    fn funded(set: &mut UtxoSet, kp: &KeyPair, value: u64, seed: u8) -> OutPoint {
        let op = OutPoint::new(TxId::from_bytes([seed; 32]), 0);
        set.insert(op, TxOutput::native(value, kp.address()));
        op
    }

    #[test]
    fn transfer_conserves_value_and_pays_fee() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let mut utxo = UtxoSet::new();
        let op = funded(&mut utxo, &alice, 100, 1);

        let tx = Transaction::signed(
            &[(op, &alice)],
            vec![TxOutput::native(90, bob.address())],
            vec![],
        );
        let summary = apply_block(&mut utxo, &[tx], 0).unwrap();

        assert_eq!(summary.fees, 10); // 100 in − 90 out
        assert_eq!(utxo.balance(&bob.address()), 90);
        assert_eq!(utxo.balance(&alice.address()), 0);
        assert!(!utxo.contains(&op), "spent input is gone");
    }

    #[test]
    fn bad_signature_is_rejected_and_atomic() {
        let alice = KeyPair::from_u64(1);
        let mallory = KeyPair::from_u64(9);
        let bob = KeyPair::from_u64(2);
        let mut utxo = UtxoSet::new();
        let op = funded(&mut utxo, &alice, 100, 1);
        let before = utxo.total_value();

        // Mallory signs a spend of Alice's output.
        let tx = Transaction::signed(
            &[(op, &mallory)],
            vec![TxOutput::native(50, bob.address())],
            vec![],
        );
        let err = apply_block(&mut utxo, &[tx], 0).unwrap_err();

        assert!(matches!(err, LedgerError::BadSignature { input: 0, .. }));
        assert_eq!(
            utxo.total_value(),
            before,
            "rejected block left state untouched"
        );
        assert!(utxo.contains(&op));
    }

    #[test]
    fn overspend_is_rejected() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let mut utxo = UtxoSet::new();
        let op = funded(&mut utxo, &alice, 100, 1);

        let tx = Transaction::signed(
            &[(op, &alice)],
            vec![TxOutput::native(101, bob.address())],
            vec![],
        );
        let err = apply_block(&mut utxo, &[tx], 0).unwrap_err();
        assert!(matches!(
            err,
            LedgerError::AssetNotConserved {
                asset_id: None,
                inputs: 100,
                outputs: 101,
                ..
            }
        ));
    }

    #[test]
    fn double_spend_within_block_is_rejected() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let mut utxo = UtxoSet::new();
        let op = funded(&mut utxo, &alice, 100, 1);

        let first = Transaction::signed(
            &[(op, &alice)],
            vec![TxOutput::native(90, bob.address())],
            b"1".to_vec(),
        );
        // Second tx spends the same outpoint; by application time it's gone.
        let second = Transaction::signed(
            &[(op, &alice)],
            vec![TxOutput::native(80, bob.address())],
            b"2".to_vec(),
        );
        let err = apply_block(&mut utxo, &[first, second], 0).unwrap_err();
        assert_eq!(err, LedgerError::MissingInput(op));
        // Atomic: neither spend took effect.
        assert!(utxo.contains(&op));
    }

    #[test]
    fn coinbase_may_claim_subsidy_plus_fee_share_but_no_more() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let miner = KeyPair::from_u64(3);
        let mut utxo = UtxoSet::new();
        let op = funded(&mut utxo, &alice, 100, 1);

        // Transfer leaves a fee of 10; subsidy 50 ⇒ producer share fees/4 = 2
        // ⇒ coinbase may claim 52 (RFC-006 75/25 burn).
        let transfer = Transaction::signed(
            &[(op, &alice)],
            vec![TxOutput::native(90, bob.address())],
            vec![],
        );
        let good_cb =
            Transaction::coinbase(vec![TxOutput::native(52, miner.address())], b"h1".to_vec());
        let summary = apply_block(&mut utxo, &[good_cb, transfer.clone()], 50).unwrap();
        assert_eq!(
            summary,
            BlockSummary {
                fees: 10,
                minted: 52
            }
        );

        // Claiming 53 overspends.
        let mut utxo2 = UtxoSet::new();
        let op2 = funded(&mut utxo2, &alice, 100, 1);
        let transfer2 = Transaction::signed(
            &[(op2, &alice)],
            vec![TxOutput::native(90, bob.address())],
            vec![],
        );
        let greedy_cb =
            Transaction::coinbase(vec![TxOutput::native(53, miner.address())], b"h1".to_vec());
        let err = apply_block(&mut utxo2, &[greedy_cb, transfer2], 50).unwrap_err();
        assert_eq!(
            err,
            LedgerError::CoinbaseOverspend {
                claimed: 53,
                allowed: 52
            }
        );
    }

    #[test]
    fn rfc006_geometric_subsidy() {
        let s = HalvingSchedule::rfc006();
        assert_eq!(s.subsidy_at(0), RFC006_GENESIS_SUBSIDY);
        assert_eq!(s.subsidy_at(RFC006_ERA_LENGTH - 1), RFC006_GENESIS_SUBSIDY);
        assert_eq!(
            s.subsidy_at(RFC006_ERA_LENGTH),
            RFC006_GENESIS_SUBSIDY * 3 / 4
        );
        assert_eq!(
            s.subsidy_at(2 * RFC006_ERA_LENGTH),
            RFC006_GENESIS_SUBSIDY * 3 / 4 * 3 / 4
        );
    }

    /// Pins the RFC-006 supply decomposition end to end.
    ///
    /// The treasury was cut from 10 x 1M to 8 x 1M on 2026-09-29. That made the
    /// 2M KVNC difference unallocated, and nothing in the workspace tested the
    /// decomposition at all — the one invariant the change actually moves. This
    /// test binds the three allocation legs together, proves the curve leg is
    /// *derived* (80M exactly, not a stored constant), and ties the constants to
    /// the real genesis coinbase so the numbers cannot drift away from what is
    /// actually minted.
    #[test]
    fn rfc006_supply_decomposition() {
        let schedule = HalvingSchedule::rfc006();

        // Curve leg: sum the per-era subsidy across every era the schedule pays
        // out (era >= 256 is zero by definition). This is the 82M figure derived
        // from s0 x era_length x 1/(1-alpha) = 10 x 2_050_000 x 4.
        let mut curve_total: u64 = 0;
        for era in 0..256u64 {
            let per_block = schedule.subsidy_at(era * RFC006_ERA_LENGTH);
            curve_total = curve_total
                .checked_add(
                    per_block
                        .checked_mul(RFC006_ERA_LENGTH)
                        .expect("per-era emission must not overflow"),
                )
                .expect("curve total must not overflow");
        }
        // The implemented schedule lands 2.46 KVNC BELOW the ideal geometric sum
        // of 82M, for two reasons that are both intentional: `subsidy_at` floors
        // each era's decay to whole atoms, and every era >= 256 pays zero, so the
        // never-converging tail is truncated. That shortfall is a property of an
        // integer subsidy schedule, not of any particular parameter value: it
        // predates the treasury change and the era-length change alike.
        // RFC-006-EmissionCurve.md has always documented the realised figure.
        assert_eq!(
            curve_total,
            8_199_999_754_000_000,
            "RFC-006 realised curve emission must stay 81 999 997.54 KVNC (ideal 82M less 2.46 KVNC of per-era floor + era-256 cutoff)"
        );

        // Treasury leg: TOTAL is derived, so this guards the derivation itself
        // and pins the tranche count that determines the genesis output count.
        assert_eq!(
            RFC006_TREASURY_TOTAL,
            RFC006_TREASURY_TRANCHE * u64::from(RFC006_TREASURY_TRANCHES),
            "RFC006_TREASURY_TOTAL must stay derived from TRANCHE * TRANCHES"
        );
        assert_eq!(
            RFC006_TREASURY_TRANCHES, 8,
            "treasury tranche count is 8 since 2026-09-29"
        );
        assert_eq!(RFC006_TREASURY_TOTAL, 8_000_000 * ATOM);

        // All three legs must fit under the cap. 90 199 997.54 of 90 200 000,
        // i.e. exactly 2.46 KVNC permanently unissued -- and that is now the
        // ONLY gap, because the 2M treasury cut was reallocated to the curve
        // via RFC006_ERA_LENGTH. The residual is entirely the integer-floor
        // shortfall in `subsidy_at`, which cannot be tuned away.
        // MAX_SUPPLY is a ceiling, not a target: never top up issuance, never
        // lower the cap, to close this 2.46 KVNC.
        let issued = curve_total
            .checked_add(RFC006_PREMINE)
            .and_then(|v| v.checked_add(RFC006_TREASURY_TOTAL))
            .expect("decomposition must not overflow");
        assert_eq!(issued, 9_019_999_754_000_000);
        assert!(issued <= MAX_SUPPLY, "issuance must never exceed the cap");
        assert_eq!(
            MAX_SUPPLY - issued,
            246_000_000,
            "2.46 KVNC unissued -- the whole residual is the subsidy_at integer-floor shortfall"
        );

        // Tie the constants to what genesis actually mints: one founder premine
        // output plus exactly one vault output per tranche.
        let founder = KeyPair::from_u64(7);
        let cb = rfc006_genesis_coinbase(founder.address(), None);
        assert_eq!(
            cb.outputs().len(),
            1 + RFC006_TREASURY_TRANCHES as usize,
            "genesis coinbase must carry 1 premine + 1 vault per tranche"
        );
        let minted: u64 = cb.outputs().iter().map(|o| o.value).sum();
        assert_eq!(minted, RFC006_PREMINE + RFC006_TREASURY_TOTAL);
    }

    #[test]
    fn rfc006_coinbase_immature_until_maturity() {
        let miner = KeyPair::from_u64(1);
        let alice = KeyPair::from_u64(2);
        // Genesis coinbases are exempt from maturity (the founder premine is an
        // initial allocation, not a block reward), so this test exercises the
        // gate with a *regular* coinbase mined at height 50.
        let genesis_cb =
            Transaction::coinbase(vec![TxOutput::native(100, miner.address())], b"cb".to_vec());
        let mut ledger =
            Ledger::new(3, HalvingSchedule::new(100, 1_000), &[genesis_cb]).expect("genesis");
        // Advance the chain to height 50, then mine a block whose coinbase is
        // the reward under test (creation_height 51 → mature at 51 + 100 = 151).
        let mut tip = ledger.genesis();
        for _ in 1..=50 {
            tip = ledger.insert(vec![tip], 1, 0, 0, &[]).unwrap();
        }
        let reward = Transaction::coinbase(
            vec![TxOutput::native(100, miner.address())],
            b"reward".to_vec(),
        );
        let op = OutPoint::new(reward.id(), 0);
        ledger.insert(vec![tip], 1, 0, 0, &[reward]).unwrap();

        let mut utxo = ledger.ledger_state();
        assert!(utxo.get_entry(&op).unwrap().is_coinbase);
        assert_eq!(utxo.get_entry(&op).unwrap().creation_height, 51);

        let spend = Transaction::signed(
            &[(op, &miner)],
            vec![TxOutput::native(90, alice.address())],
            vec![],
        );
        // height 51 < 51+100 → immature
        let err = apply_block_inner(
            &mut utxo.clone(),
            &mut HashMap::new(),
            std::slice::from_ref(&spend),
            0,
            0, // cumulative_minted
            51,
            51,
            0, // multisig_activation_score
            0, // native_token_activation_score
            0, // stealth_activation_score
            0, // script_v2_activation_score
            0, // htlc_activation_score
            VAULT_ACTIVATION_SCORE,
            MINT_PRICE_ACTIVATION_SCORE,
            ASSET_LOGO_ACTIVATION_SCORE,
        )
        .unwrap_err();
        assert!(matches!(err, LedgerError::CoinbaseImmature { .. }));

        // height 151 → mature
        apply_block_inner(
            &mut utxo,
            &mut HashMap::new(),
            std::slice::from_ref(&spend),
            0,
            0, // cumulative_minted
            151,
            151,
            0, // multisig_activation_score
            0, // native_token_activation_score
            0, // stealth_activation_score
            0, // script_v2_activation_score
            0, // htlc_activation_score
            VAULT_ACTIVATION_SCORE,
            MINT_PRICE_ACTIVATION_SCORE,
            ASSET_LOGO_ACTIVATION_SCORE,
        )
        .unwrap();
        assert!(!utxo.contains(&op));
    }

    // KVP-107: asset_logo_activation_score enforcement tests.
    //
    // The rule: when `blue_score > asset_logo_activation_score`, any logo_uri or
    // metadata_uri on a registry entry involved in the transaction must satisfy
    // the size constraints from `LogoUri::new` / `MetadataUri::new`. Before the
    // activation score, logos are not validated.

    fn asset_output(value: u64, asset_id: AssetId, addr: crate::keys::Address) -> TxOutput {
        TxOutput::new(value, Some(asset_id), addr)
    }

    #[test]
    fn logo_enforcement_rejects_oversized_logo_uri() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let asset_id = AssetId::from_bytes([7u8; 32]);

        // Fund an asset output for Alice.
        let mut utxo = UtxoSet::new();
        let op = OutPoint::new(TxId::from_bytes([1; 32]), 0);
        utxo.insert(op, asset_output(100, asset_id, alice.address()));

        // Registry entry with an oversized logo URI (> 256 bytes).
        let bad_logo = LogoUri {
            scheme: LogoScheme::Ipfs,
            content_hash: [0u8; 32],
            uri: "x".repeat(LogoUri::MAX_URI_LEN + 1),
        };
        let entry = AssetRegistryEntry {
            asset_id,
            kind: AssetKind::Fungible,
            max_supply: u64::MAX,
            minted: 0,
            metadata_hash: None,
            collection_id: None,
            creator: None,
            mint_price_per_unit: 0,
            logo_uri: Some(bad_logo),
            metadata_uri: None,
        };
        let mut registry = HashMap::new();
        registry.insert(asset_id, entry);

        // Alice sends 50 to Bob (asset output).
        let tx = Transaction::signed(
            &[(op, &alice)],
            vec![asset_output(50, asset_id, bob.address())],
            vec![],
        );

        // blue_score (100) > asset_logo_activation_score (0) → enforcement active.
        let err = apply_block_inner(
            &mut utxo,
            &mut registry,
            std::slice::from_ref(&tx),
            0,
            0,
            0,
            100, // blue_score
            0,
            0,
            0,
            0,
            0,
            VAULT_ACTIVATION_SCORE,
            MINT_PRICE_ACTIVATION_SCORE,
            ASSET_LOGO_ACTIVATION_SCORE,
        )
        .unwrap_err();
        assert!(matches!(
            err,
            LedgerError::InvalidAssetLogo {
                field: "logo_uri",
                ..
            }
        ));
    }

    #[test]
    fn logo_enforcement_rejects_oversized_metadata_uri() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let asset_id = AssetId::from_bytes([8u8; 32]);

        let mut utxo = UtxoSet::new();
        let op = OutPoint::new(TxId::from_bytes([2; 32]), 0);
        utxo.insert(op, asset_output(100, asset_id, alice.address()));

        let bad_metadata = MetadataUri {
            scheme: MetadataScheme::Ipfs,
            content_hash: [0u8; 32],
            uri: "y".repeat(MetadataUri::MAX_URI_LEN + 1),
        };
        let entry = AssetRegistryEntry {
            asset_id,
            kind: AssetKind::Fungible,
            max_supply: u64::MAX,
            minted: 0,
            metadata_hash: None,
            collection_id: None,
            creator: None,
            mint_price_per_unit: 0,
            logo_uri: None,
            metadata_uri: Some(bad_metadata),
        };
        let mut registry = HashMap::new();
        registry.insert(asset_id, entry);

        let tx = Transaction::signed(
            &[(op, &alice)],
            vec![asset_output(50, asset_id, bob.address())],
            vec![],
        );

        let err = apply_block_inner(
            &mut utxo,
            &mut registry,
            std::slice::from_ref(&tx),
            0,
            0,
            0,
            100,
            0,
            0,
            0,
            0,
            0,
            VAULT_ACTIVATION_SCORE,
            MINT_PRICE_ACTIVATION_SCORE,
            ASSET_LOGO_ACTIVATION_SCORE,
        )
        .unwrap_err();
        assert!(matches!(
            err,
            LedgerError::InvalidAssetLogo {
                field: "metadata_uri",
                ..
            }
        ));
    }

    #[test]
    fn logo_enforcement_allows_valid_uris() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let asset_id = AssetId::from_bytes([9u8; 32]);

        let mut utxo = UtxoSet::new();
        let op = OutPoint::new(TxId::from_bytes([3; 32]), 0);
        utxo.insert(op, asset_output(100, asset_id, alice.address()));

        let good_logo = LogoUri {
            scheme: LogoScheme::Ipfs,
            content_hash: [0u8; 32],
            uri: "ipfs://QmValid".to_string(),
        };
        let good_metadata = MetadataUri {
            scheme: MetadataScheme::Ipfs,
            content_hash: [0u8; 32],
            uri: "ipfs://QmValid".to_string(),
        };
        let entry = AssetRegistryEntry {
            asset_id,
            kind: AssetKind::Fungible,
            max_supply: u64::MAX,
            minted: 0,
            metadata_hash: None,
            collection_id: None,
            creator: None,
            mint_price_per_unit: 0,
            logo_uri: Some(good_logo),
            metadata_uri: Some(good_metadata),
        };
        let mut registry = HashMap::new();
        registry.insert(asset_id, entry);

        let tx = Transaction::signed(
            &[(op, &alice)],
            vec![asset_output(50, asset_id, bob.address())],
            vec![],
        );

        // Valid URIs pass even with enforcement active.
        apply_block_inner(
            &mut utxo,
            &mut registry,
            std::slice::from_ref(&tx),
            0,
            0,
            0,
            100,
            0,
            0,
            0,
            0,
            0,
            VAULT_ACTIVATION_SCORE,
            MINT_PRICE_ACTIVATION_SCORE,
            ASSET_LOGO_ACTIVATION_SCORE,
        )
        .unwrap();
    }

    #[test]
    fn logo_enforcement_inactive_before_activation_score() {
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let asset_id = AssetId::from_bytes([10u8; 32]);

        let mut utxo = UtxoSet::new();
        let op = OutPoint::new(TxId::from_bytes([4; 32]), 0);
        utxo.insert(op, asset_output(100, asset_id, alice.address()));

        // Oversized logo URI.
        let bad_logo = LogoUri {
            scheme: LogoScheme::Ipfs,
            content_hash: [0u8; 32],
            uri: "x".repeat(LogoUri::MAX_URI_LEN + 1),
        };
        let entry = AssetRegistryEntry {
            asset_id,
            kind: AssetKind::Fungible,
            max_supply: u64::MAX,
            minted: 0,
            metadata_hash: None,
            collection_id: None,
            creator: None,
            mint_price_per_unit: 0,
            logo_uri: Some(bad_logo),
            metadata_uri: None,
        };
        let mut registry = HashMap::new();
        registry.insert(asset_id, entry);

        let tx = Transaction::signed(
            &[(op, &alice)],
            vec![asset_output(50, asset_id, bob.address())],
            vec![],
        );

        // blue_score (1) > native_token_activation_score (0) → native token active.
        // blue_score (1) <= asset_logo_activation_score (100) → logo enforcement inactive.
        // The oversized logo is not validated.
        apply_block_inner(
            &mut utxo,
            &mut registry,
            std::slice::from_ref(&tx),
            0,
            0,
            0,
            1, // blue_score
            0,
            0,
            0,
            0,
            0,
            VAULT_ACTIVATION_SCORE,
            MINT_PRICE_ACTIVATION_SCORE,
            100, // asset_logo_activation_score
        )
        .unwrap();
    }

    // KVP-107: registry population from coinbase tag with creation params.
    //
    // The coinbase transaction's `tag` field carries an encoded
    // `AssetCreationParams` with magic prefix `b"KVP107"`. `update_asset_registry`
    // decodes this and uses `new_fungible_with_mint_price` /
    // `new_nft_with_mint_price` to populate the registry with mint_price,
    // logo_uri, and metadata_uri.

    #[test]
    fn registry_population_with_creation_params_fungible() {
        let alice = KeyPair::from_u64(1);
        let asset_id = AssetId::from_bytes([11u8; 32]);

        // Build creation params for a fungible asset with mint price and logo
        let params = AssetCreationParams {
            mint_price_per_unit: 100_000_000, // 1 KVNC per unit
            logo_uri: Some(LogoUri {
                scheme: LogoScheme::Ipfs,
                content_hash: [3u8; 32],
                uri: "ipfs://QmFungibleLogo".to_string(),
            }),
            metadata_uri: Some(MetadataUri {
                scheme: MetadataScheme::Ipfs,
                content_hash: [4u8; 32],
                uri: "ipfs://QmFungibleMetadata".to_string(),
            }),
            creator: Some([5u8; 32]),
        };
        let encoded_tag = params.encode();

        // Coinbase tx with the creation params in its tag
        // Fungible: output value > 1
        let cb = Transaction::coinbase(
            vec![asset_output(100_000, asset_id, alice.address())],
            encoded_tag,
        );

        // Create a Ledger to test update_asset_registry
        let mut ledger = Ledger::new(3, HalvingSchedule::new(100, 1_000), &[]).expect("genesis");
        ledger.update_asset_registry(std::slice::from_ref(&cb), true);

        let entry = ledger.asset_registry.get(&asset_id).unwrap();
        // Kind inferred from output value > 1 → Fungible
        assert_eq!(entry.kind, AssetKind::Fungible);
        // max_supply is u64::MAX for fungible (not in creation params)
        assert_eq!(entry.max_supply, u64::MAX);
        assert_eq!(entry.mint_price_per_unit, 100_000_000);
        assert!(entry.logo_uri.is_some());
        assert_eq!(
            entry.logo_uri.as_ref().unwrap().uri,
            "ipfs://QmFungibleLogo"
        );
        assert!(entry.metadata_uri.is_some());
        assert_eq!(
            entry.metadata_uri.as_ref().unwrap().uri,
            "ipfs://QmFungibleMetadata"
        );
        assert_eq!(entry.creator, Some([5u8; 32]));
    }

    #[test]
    fn registry_population_with_creation_params_nft() {
        let alice = KeyPair::from_u64(1);
        let asset_id = AssetId::from_bytes([12u8; 32]);

        let params = AssetCreationParams {
            mint_price_per_unit: 500_000_000, // 5 KVNC per unit
            logo_uri: Some(LogoUri {
                scheme: LogoScheme::Https,
                content_hash: [6u8; 32],
                uri: "https://example.com/nft-logo.png".to_string(),
            }),
            metadata_uri: None,
            creator: Some([7u8; 32]),
        };
        let encoded_tag = params.encode();

        // NFT: output value == 1
        let cb = Transaction::coinbase(
            vec![asset_output(1, asset_id, alice.address())],
            encoded_tag,
        );

        let mut ledger = Ledger::new(3, HalvingSchedule::new(100, 1_000), &[]).expect("genesis");
        ledger.update_asset_registry(std::slice::from_ref(&cb), true);

        let entry = ledger.asset_registry.get(&asset_id).unwrap();
        // Kind inferred from output value == 1 → NFT
        assert_eq!(entry.kind, AssetKind::NonFungible);
        assert_eq!(entry.max_supply, 1);
        assert_eq!(entry.mint_price_per_unit, 500_000_000);
        assert!(entry.logo_uri.is_some());
        assert_eq!(
            entry.logo_uri.as_ref().unwrap().uri,
            "https://example.com/nft-logo.png"
        );
        assert!(entry.metadata_uri.is_none());
        assert_eq!(entry.creator, Some([7u8; 32]));
    }

    #[test]
    fn registry_population_legacy_tag_uses_defaults() {
        let alice = KeyPair::from_u64(1);
        let asset_id = AssetId::from_bytes([13u8; 32]);

        // Legacy tag without KVP107 magic prefix
        let legacy_tag = b"legacy-coinbase-tag".to_vec();

        let cb = Transaction::coinbase(
            vec![asset_output(100, asset_id, alice.address())],
            legacy_tag,
        );

        let mut ledger = Ledger::new(3, HalvingSchedule::new(100, 1_000), &[]).expect("genesis");
        ledger.update_asset_registry(std::slice::from_ref(&cb), true);

        let entry = ledger.asset_registry.get(&asset_id).unwrap();
        // Legacy entry should use defaults: mint_price=0, no logo, no metadata
        assert_eq!(entry.mint_price_per_unit, 0);
        assert!(entry.logo_uri.is_none());
        assert!(entry.metadata_uri.is_none());
        assert!(entry.creator.is_none());
    }
}

#[cfg(test)]
mod prune_tests {
    use super::*;
    use crate::keys::KeyPair;
    use crate::tx::{OutPoint, Transaction, TxOutput};

    #[test]
    fn prune_is_idempotent_and_preserves_reconstruction() {
        // Build a chain past the finality boundary with non-trivial deltas,
        // then call prune repeatedly. Non-final block states must not change,
        // and a second prune must be a no-op.
        let alice = KeyPair::from_u64(1);
        let bob = KeyPair::from_u64(2);
        let genesis_cb = Transaction::coinbase(
            vec![TxOutput::native(1_000, alice.address())],
            b"g".to_vec(),
        );
        let genesis_cb_id = genesis_cb.id();
        let mut ledger =
            Ledger::with_finality(3, HalvingSchedule::new(1_000, 1_000), &[genesis_cb], 5).unwrap();
        // Maturity the genesis coinbase (creation_height 0 → spendable at height 100).
        for h in 1..=100 {
            ledger.insert(vec![ledger.genesis()], 1, h, 0, &[]).unwrap();
        }

        // Spend the genesis coin so deltas carry real UTXO changes.
        let coin = OutPoint::new(genesis_cb_id, 0);
        let spend = Transaction::signed(
            &[(coin, &alice)],
            vec![TxOutput::native(500, bob.address())],
            Vec::new(),
        );
        let mut tip = ledger
            .insert(vec![ledger.genesis()], 1, 1, 0, &[spend])
            .unwrap();

        // Extend well past finality so some deltas are already folded.
        for h in 2..20 {
            tip = ledger.insert(vec![tip], 1, h, 0, &[]).unwrap();
        }

        assert!(ledger.finality_score() > 0, "finality must be active");

        // Snapshot every non-final block's reconstructed state.
        let before: Vec<(BlockId, UtxoSet)> = ledger
            .dag()
            .linearize()
            .into_iter()
            .filter(|id| ledger.state(id).is_some())
            .map(|id| (id, ledger.state(&id).unwrap()))
            .collect();
        assert!(!before.is_empty(), "non-final blocks must exist");

        // First explicit prune.
        ledger.prune();
        for (id, ref_utxo) in &before {
            assert_eq!(
                ledger.state(id).as_ref(),
                Some(ref_utxo),
                "first prune changed UTXO view of {id}"
            );
        }

        // Second prune must be idempotent: the threshold has not advanced,
        // so no new deltas are eligible for folding.
        ledger.prune();
        for (id, ref_utxo) in &before {
            assert_eq!(
                ledger.state(id).as_ref(),
                Some(ref_utxo),
                "second prune changed UTXO view of {id}"
            );
        }

        // The ledger must keep accepting blocks after redundant pruning.
        let next = ledger.insert(vec![tip], 1, 20, 0, &[]).unwrap();
        assert!(
            ledger.state(&next).is_some(),
            "new block above finality reconstructs"
        );
    }
}
