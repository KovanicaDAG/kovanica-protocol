//! Transaction builders for Kovanica.
//!
//! Builders produce unsigned [`Transaction`] values that are then signed with a
//! [`Keypair`]. The canonical wire format + sighash live in `kovanica-types`
//! (byte-identical to `kovanica-state` `tx.rs`); signatures go into the input
//! witness stack exactly like the node's `TxInput::single_sig`.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use kovanica_keys::scripts::{HtlcScript, MultisigScript, VaultScript};
use kovanica_keys::Keypair;
use kovanica_types::{Address, Amount, AssetId, NetworkId, Transaction, TxInput, TxOutput, Utxo};

/// Errors from transaction construction / signing.
#[derive(Debug, thiserror::Error)]
pub enum TxError {
    /// Missing required field.
    #[error("missing required field: {0}")]
    MissingField(&'static str),
    /// No inputs provided.
    #[error("transaction has no inputs")]
    NoInputs,
    /// No outputs provided.
    #[error("transaction has no outputs")]
    NoOutputs,
    /// Value conservation / fee inconsistency (best-effort check).
    #[error("value mismatch: inputs {inputs} atoms, outputs+fee {outputs} atoms")]
    ValueMismatch {
        /// Sum of input values in atoms.
        inputs: u64,
        /// Sum of outputs + fee in atoms.
        outputs: u64,
    },
    /// Signing failed.
    #[error("signing failed: {0}")]
    Signing(String),
    /// Script construction / witness assembly failed.
    #[error("script error: {0}")]
    Script(String),
}

/// Builder for a simple native (or single-asset) transfer.
#[derive(Debug, Default)]
pub struct TransferBuilder {
    network: Option<NetworkId>,
    inputs: Vec<Utxo>,
    outputs: Vec<TxOutput>,
    fee: Option<Amount>,
    change_address: Option<Address>,
    tag: Vec<u8>,
    n_lock_time: u32,
    sequence: u32,
}

impl TransferBuilder {
    /// New empty builder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Target network (client-side label; never serialised).
    pub fn network(mut self, network: NetworkId) -> Self {
        self.network = Some(network);
        self
    }

    /// Add a spendable UTXO.
    pub fn add_input(mut self, utxo: Utxo) -> Self {
        self.inputs.push(utxo);
        self
    }

    /// Add a recipient output.
    pub fn add_output(mut self, address: Address, amount: Amount, asset_id: AssetId) -> Self {
        let asset = (!asset_id.is_native()).then_some(asset_id);
        self.outputs
            .push(TxOutput::new(amount.atoms(), asset, address));
        self
    }

    /// Convenience: native KVNC output.
    pub fn add_native_output(self, address: Address, amount: Amount) -> Self {
        self.add_output(address, amount, AssetId::NATIVE)
    }

    /// Explicit fee (atoms). If omitted, caller should compute via `kovanica-fee`.
    pub fn set_fee(mut self, fee: Amount) -> Self {
        self.fee = Some(fee);
        self
    }

    /// Change address for leftover value after outputs + fee.
    pub fn set_change(mut self, address: Address) -> Self {
        self.change_address = Some(address);
        self
    }

    /// Extra committed bytes carried in the transaction tag (default: empty).
    pub fn tag(mut self, tag: impl Into<Vec<u8>>) -> Self {
        self.tag = tag.into();
        self
    }

    /// Lock time (BIP-65 CLTV); bound into the sighash.
    pub fn n_lock_time(mut self, value: u32) -> Self {
        self.n_lock_time = value;
        self
    }

    /// Sequence (BIP-112 CSV); bound into the sighash.
    pub fn sequence(mut self, value: u32) -> Self {
        self.sequence = value;
        self
    }

    /// Build an unsigned transaction.
    ///
    /// Performs basic value conservation if fee and change are set.
    pub fn build(self) -> Result<Transaction, TxError> {
        let network = self.network.ok_or(TxError::MissingField("network"))?;
        if self.inputs.is_empty() {
            return Err(TxError::NoInputs);
        }
        if self.outputs.is_empty() && self.change_address.is_none() {
            return Err(TxError::NoOutputs);
        }

        let mut outputs = self.outputs;
        let fee = self.fee.unwrap_or(Amount::ZERO);

        // --- Native (KVNC) — carries the fee; existing behaviour. ---
        let native_in: u64 = self
            .inputs
            .iter()
            .filter(|u| u.asset_id.is_native())
            .map(|u| u.amount.atoms())
            .sum();
        let native_out: u64 = outputs
            .iter()
            .filter(|o| o.asset_id.map(|a| a.is_native()).unwrap_or(true))
            .map(|o| o.value)
            .sum::<u64>()
            .saturating_add(fee.atoms());

        if let Some(change_addr) = self.change_address {
            if native_in > native_out {
                let change = native_in - native_out;
                if change > 0 {
                    outputs.push(TxOutput::native(change, change_addr));
                }
            } else if native_in < native_out {
                return Err(TxError::ValueMismatch {
                    inputs: native_in,
                    outputs: native_out,
                });
            }
        }

        // --- Non-native assets (KVP-102): per-asset conservation. ---
        // Fees never apply to non-native assets, so each must balance exactly
        // (in == out). A surplus is returned as change in the *same* asset when
        // a change address is set; otherwise the caller must have added an
        // explicit change output (or the tx would destroy asset units).
        let mut asset_ids: std::collections::BTreeSet<AssetId> = self
            .inputs
            .iter()
            .filter(|u| !u.asset_id.is_native())
            .map(|u| u.asset_id)
            .collect();
        for o in &outputs {
            if let Some(a) = o.asset_id.filter(|a| !a.is_native()) {
                asset_ids.insert(a);
            }
        }
        for asset in asset_ids {
            let asset_in: u64 = self
                .inputs
                .iter()
                .filter(|u| u.asset_id == asset)
                .map(|u| u.amount.atoms())
                .sum();
            let asset_out: u64 = outputs
                .iter()
                .filter(|o| o.asset_id == Some(asset))
                .map(|o| o.value)
                .sum();
            match asset_in.cmp(&asset_out) {
                std::cmp::Ordering::Equal => {}
                std::cmp::Ordering::Greater => {
                    let Some(change_addr) = self.change_address else {
                        return Err(TxError::ValueMismatch {
                            inputs: asset_in,
                            outputs: asset_out,
                        });
                    };
                    let change = asset_in - asset_out;
                    if change > 0 {
                        outputs.push(TxOutput::new(change, Some(asset), change_addr));
                    }
                }
                std::cmp::Ordering::Less => {
                    return Err(TxError::ValueMismatch {
                        inputs: asset_in,
                        outputs: asset_out,
                    });
                }
            }
        }

        let inputs: Vec<TxInput> = self
            .inputs
            .into_iter()
            .map(|u| TxInput::fresh(u.tx_hash, u.vout))
            .collect();

        let mut tx = Transaction::new(network, inputs, outputs, self.tag);
        tx.n_lock_time = self.n_lock_time;
        tx.sequence = self.sequence;
        Ok(tx)
    }
}

/// Signed transaction ready for broadcast.
#[derive(Debug, Clone)]
pub struct SignedTx {
    /// Underlying transaction (signatures filled into the witness stack).
    pub tx: Transaction,
}

impl SignedTx {
    /// Sign all inputs with the same keypair (single-signer / P2PK case).
    ///
    /// Per node (`tx.rs`): Ed25519 is computed over the **32-byte sighash**,
    /// and the 64-byte signature becomes the input's single witness item
    /// (`TxInput::single_sig`). The node verifies with `verify_strict`.
    pub fn sign(mut tx: Transaction, keypair: &Keypair) -> Result<Self, TxError> {
        let hash = tx.sighash();
        let signature = keypair.sign(&hash);
        for input in &mut tx.inputs {
            input.witness = vec![signature.0.to_vec()];
        }
        Ok(SignedTx { tx })
    }

    /// Canonical hex form for `POST /api/submit_tx` (`{"tx_hex": ...}`).
    pub fn tx_hex(&self) -> String {
        self.tx.encode_hex()
    }
}

/// Multi-party (M-of-N) signing flow for spenders of a Version 0x01 P2SH UTXO.
///
/// The transfer is built with [`TransferBuilder`] (unsigned). Each co-signer
/// computes `sign_share` over the same sighash **offline**; one collector
/// assembles the spend witness with `attach_witness` (redeem script first,
/// then exactly M signatures — the ledger's `witness[0]` / `witness[1..=M]`
/// layout per RFC-001).
#[derive(Debug, Clone)]
pub struct MultisigSigner {
    /// The unsigned transaction being co-signed.
    pub tx: Transaction,
}

impl MultisigSigner {
    /// Wrap an unsigned transaction (e.g. from [`TransferBuilder::build`]).
    pub fn new(tx: Transaction) -> Self {
        MultisigSigner { tx }
    }

    /// This co-signer's detached signature over the 32-byte sighash.
    ///
    /// Pure offline operation: only the sighash leaves the device.
    pub fn sign_share(&self, keypair: &Keypair) -> [u8; 64] {
        keypair.sign(&self.tx.sighash()).0
    }

    /// Assemble `[redeem_script, sig_1, …, sig_M]` into every input's witness.
    ///
    /// `signatures` must contain exactly `M = script.m` valid entries; the
    /// ledger verifies each against the script's public keys. This is a
    /// **client-side** assembly step — the node never sees partial signatures.
    pub fn attach_witness(
        &mut self,
        script: &MultisigScript,
        signatures: &[[u8; 64]],
    ) -> Result<(), TxError> {
        let witness = script
            .spend_witness(signatures)
            .map_err(|e| TxError::Script(e.to_string()))?;
        for input in &mut self.tx.inputs {
            input.witness = witness.clone();
        }
        Ok(())
    }

    /// Canonical hex form for `POST /api/submit_tx` (`{"tx_hex": ...}`).
    pub fn tx_hex(&self) -> String {
        self.tx.encode_hex()
    }
}

/// Builder for a transaction that locks funds to an HTLC template
/// (version 0x04 address, RFC-004 / KVP-104).
///
/// Produces an unsigned transaction whose outputs are the HTLC output (native
/// amount to `script.address()`) plus optional change. Redemption/refund
/// witnesses are assembled from the script after receipt of the counterparty
/// key material:
/// - redeem: `script.redeem_witness(preimage, recipient_sig)`
/// - refund: `script.refund_witness(sender_sig)` (after `timeout`)
#[derive(Debug)]
pub struct HtlcBuilder {
    inner: TransferBuilder,
    script: HtlcScript,
    amount: Option<Amount>,
}

impl HtlcBuilder {
    /// New builder that will lock `amount` to the HTLC template's address.
    pub fn new(script: HtlcScript) -> Self {
        HtlcBuilder {
            inner: TransferBuilder::new(),
            script,
            amount: None,
        }
    }

    /// Target network (client-side label; never serialised).
    pub fn network(mut self, network: NetworkId) -> Self {
        self.inner = self.inner.network(network);
        self
    }

    /// Add a spendable UTXO (the funding source).
    pub fn add_input(mut self, utxo: Utxo) -> Self {
        self.inner = self.inner.add_input(utxo);
        self
    }

    /// Native KVNC amount locked into the HTLC output.
    pub fn amount(mut self, amount: Amount) -> Self {
        self.amount = Some(amount);
        self
    }

    /// Explicit fee (atoms). If omitted, caller should compute via `kovanica-fee`.
    pub fn set_fee(mut self, fee: Amount) -> Self {
        self.inner = self.inner.set_fee(fee);
        self
    }

    /// Change address for leftover value after HTLC output + fee.
    pub fn set_change(mut self, address: Address) -> Self {
        self.inner = self.inner.set_change(address);
        self
    }

    /// Extra committed bytes carried in the transaction tag (default: empty).
    pub fn tag(mut self, tag: impl Into<Vec<u8>>) -> Self {
        self.inner = self.inner.tag(tag);
        self
    }

    /// Lock time (BIP-65 CLTV); bound into the sighash.
    pub fn n_lock_time(mut self, value: u32) -> Self {
        self.inner = self.inner.n_lock_time(value);
        self
    }

    /// Sequence (BIP-112 CSV); bound into the sighash.
    pub fn sequence(mut self, value: u32) -> Self {
        self.inner = self.inner.sequence(value);
        self
    }

    /// Build the unsigned funding transaction.
    ///
    /// The HTLC output (native, to `script.address()`) is appended first;
    /// change (if any) is calculated from the remaining native value.
    pub fn build(self) -> Result<Transaction, TxError> {
        let amount = self
            .amount
            .ok_or(TxError::MissingField("amount (HTLC value)"))?;
        let inner = self.inner.add_native_output(self.script.address(), amount);
        inner.build()
    }
}

/// Builder for a transaction that locks funds to a vault template
/// (version 0x05 address, RFC-005 / KVP-105).
///
/// The vault output is spendable only after its absolute/relative lock
/// conditions are met; the spend witness comes from
/// `script.spend_witness(owner_sig)`.
#[derive(Debug)]
pub struct VaultBuilder {
    inner: TransferBuilder,
    script: VaultScript,
    amount: Option<Amount>,
}

impl VaultBuilder {
    /// New builder that will lock `amount` to the vault template's address.
    pub fn new(script: VaultScript) -> Self {
        VaultBuilder {
            inner: TransferBuilder::new(),
            script,
            amount: None,
        }
    }

    /// Target network (client-side label; never serialised).
    pub fn network(mut self, network: NetworkId) -> Self {
        self.inner = self.inner.network(network);
        self
    }

    /// Add a spendable UTXO (the funding source).
    pub fn add_input(mut self, utxo: Utxo) -> Self {
        self.inner = self.inner.add_input(utxo);
        self
    }

    /// Native KVNC amount locked into the vault output.
    pub fn amount(mut self, amount: Amount) -> Self {
        self.amount = Some(amount);
        self
    }

    /// Explicit fee (atoms). If omitted, caller should compute via `kovanica-fee`.
    pub fn set_fee(mut self, fee: Amount) -> Self {
        self.inner = self.inner.set_fee(fee);
        self
    }

    /// Change address for leftover value after vault output + fee.
    pub fn set_change(mut self, address: Address) -> Self {
        self.inner = self.inner.set_change(address);
        self
    }

    /// Extra committed bytes carried in the transaction tag (default: empty).
    pub fn tag(mut self, tag: impl Into<Vec<u8>>) -> Self {
        self.inner = self.inner.tag(tag);
        self
    }

    /// Lock time (BIP-65 CLTV); bound into the sighash.
    pub fn n_lock_time(mut self, value: u32) -> Self {
        self.inner = self.inner.n_lock_time(value);
        self
    }

    /// Sequence (BIP-112 CSV); bound into the sighash.
    pub fn sequence(mut self, value: u32) -> Self {
        self.inner = self.inner.sequence(value);
        self
    }

    /// Build the unsigned funding transaction.
    ///
    /// The vault output (native, to `script.address()`) is appended first;
    /// change (if any) is calculated from the remaining native value.
    pub fn build(self) -> Result<Transaction, TxError> {
        let amount = self
            .amount
            .ok_or(TxError::MissingField("amount (vault value)"))?;
        let inner = self.inner.add_native_output(self.script.address(), amount);
        inner.build()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_address(byte: u8) -> Address {
        Address::p2pk([byte; 32])
    }

    fn dummy_utxo(atoms: u64) -> Utxo {
        Utxo {
            tx_hash: kovanica_types::TxHash::ZERO,
            vout: 0,
            amount: Amount::from_atoms(atoms),
            asset_id: AssetId::NATIVE,
            address: test_address(0x11),
        }
    }

    #[test]
    fn simple_transfer_builds() {
        let tx = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(dummy_utxo(1_000_000_000))
            .add_native_output(test_address(0xAA), Amount::from_kvnc(5))
            .set_fee(Amount::from_atoms(10_000))
            .set_change(test_address(0xBB))
            .build()
            .unwrap();
        assert_eq!(tx.network, NetworkId::Testnet);
        assert_eq!(tx.inputs.len(), 1);
        assert!(tx.outputs.len() >= 2);
        // Change output is native.
        assert!(tx.outputs.last().unwrap().asset_id.is_none());
    }

    #[test]
    fn signing_fills_witness_and_verifies_at_node_like_level() {
        let mnemonic =
            kovanica_keys::Mnemonic::generate(kovanica_keys::WordCount::Words12).unwrap();
        let kp = kovanica_keys::Keypair::from_mnemonic(&mnemonic, "");
        let from = kp.address();
        let tx = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(Utxo {
                tx_hash: kovanica_types::TxHash::ZERO,
                vout: 3,
                amount: Amount::from_atoms(1_000_000_000),
                asset_id: AssetId::NATIVE,
                address: from,
            })
            .add_native_output(test_address(0xAA), Amount::from_atoms(900_000_000))
            .set_fee(Amount::from_atoms(1_000))
            .set_change(from)
            .build()
            .unwrap();
        let signed = SignedTx::sign(tx, &kp).unwrap();
        // Each input witness holds exactly one 64-byte signature.
        for input in &signed.tx.inputs {
            assert_eq!(input.witness.len(), 1);
            assert_eq!(input.witness[0].len(), 64);
            // The signature verifies strictly against the sighash.
            let sig = kovanica_types::Signature(
                input.witness[0].as_slice().try_into().expect("64 bytes"),
            );
            kp.verify(&signed.tx.sighash(), &sig).unwrap();
        }
        assert!(signed.tx.sighash_hex().len() == 64);
        assert!(signed.tx_hex().len() > 64);
    }

    #[test]
    fn rejects_empty_inputs() {
        let err = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_native_output(test_address(0xAA), Amount::from_kvnc(1))
            .build()
            .unwrap_err();
        assert!(matches!(err, TxError::NoInputs));
    }

    fn asset_id(byte: u8) -> AssetId {
        AssetId(kovanica_types::Hash32([byte; 32]))
    }

    fn asset_utxo(atoms: u64, asset: AssetId, byte: u8) -> Utxo {
        Utxo {
            tx_hash: kovanica_types::TxHash::ZERO,
            vout: 0,
            amount: Amount::from_atoms(atoms),
            asset_id: asset,
            address: test_address(byte),
        }
    }

    #[test]
    fn asset_transfer_returns_change_in_same_asset() {
        let asset = asset_id(0x42);
        let tx = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(asset_utxo(1_000, asset, 0x11))
            .add_output(test_address(0xAA), Amount::from_atoms(400), asset)
            .set_change(test_address(0xBB))
            .build()
            .unwrap();
        // Two outputs: recipient + change, both in the same asset.
        assert_eq!(tx.outputs.len(), 2);
        let recipient = &tx.outputs[0];
        assert_eq!(recipient.value, 400);
        assert_eq!(recipient.asset_id, Some(asset));
        let change = tx.outputs.last().unwrap();
        assert_eq!(change.value, 600);
        assert_eq!(change.asset_id, Some(asset));
        // Native is untouched: no native inputs, no native outputs.
        assert!(tx.outputs.iter().all(|o| !o.asset_id.is_none()));
    }

    #[test]
    fn asset_transfer_underfunded_rejected() {
        let asset = asset_id(0x42);
        let err = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(asset_utxo(300, asset, 0x11))
            .add_output(test_address(0xAA), Amount::from_atoms(500), asset)
            .set_change(test_address(0xBB))
            .build()
            .unwrap_err();
        assert!(matches!(err, TxError::ValueMismatch { .. }));
    }

    #[test]
    fn asset_transfer_needs_exact_balance_without_change_address() {
        let asset = asset_id(0x42);
        // No change address: in (1000) != out (400) destroys 600 units.
        let err = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(asset_utxo(1_000, asset, 0x11))
            .add_output(test_address(0xAA), Amount::from_atoms(400), asset)
            .build()
            .unwrap_err();
        assert!(matches!(err, TxError::ValueMismatch { .. }));
        // Exact balance is accepted.
        let ok = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(asset_utxo(400, asset, 0x11))
            .add_output(test_address(0xAA), Amount::from_atoms(400), asset)
            .build()
            .unwrap();
        assert_eq!(ok.outputs.len(), 1);
    }

    #[test]
    fn mixed_native_and_asset_transfer_balances_both() {
        let asset = asset_id(0x42);
        let tx = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(dummy_utxo(1_000_000_000))
            .add_input(asset_utxo(500, asset, 0x11))
            .add_native_output(test_address(0xAA), Amount::from_kvnc(5))
            .add_output(test_address(0xBB), Amount::from_atoms(200), asset)
            .set_fee(Amount::from_atoms(10_000))
            .set_change(test_address(0xCC))
            .build()
            .unwrap();
        // Native: 10 - 5 - fee -> change; asset: 500 - 200 -> 300 change.
        let native_sum: u64 = tx
            .outputs
            .iter()
            .filter(|o| o.asset_id.is_none())
            .map(|o| o.value)
            .sum();
        let asset_sum: u64 = tx
            .outputs
            .iter()
            .filter(|o| o.asset_id == Some(asset))
            .map(|o| o.value)
            .sum();
        assert_eq!(native_sum, 1_000_000_000 - 10_000);
        assert_eq!(asset_sum, 500);
    }

    fn valid_pk(k: u64) -> [u8; 32] {
        use ed25519_dalek::SigningKey;
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&k.to_le_bytes());
        SigningKey::from_bytes(&bytes).verifying_key().to_bytes()
    }

    #[test]
    fn htlc_builder_locks_to_script_address() {
        let script = HtlcScript::new(
            *blake3::hash(b"preimage").as_bytes(),
            valid_pk(1),
            valid_pk(2),
            1440,
        )
        .unwrap();
        let tx = HtlcBuilder::new(script)
            .network(NetworkId::Testnet)
            .add_input(dummy_utxo(1_000_000_000))
            .amount(Amount::from_atoms(400_000_000))
            .set_fee(Amount::from_atoms(10_000))
            .set_change(test_address(0xBB))
            .build()
            .unwrap();
        // First output is the HTLC (version 0x04) output with the exact amount.
        let htlc_out = &tx.outputs[0];
        assert_eq!(htlc_out.value, 400_000_000);
        assert_eq!(htlc_out.owner, script.address());
        assert_eq!(htlc_out.owner.version(), kovanica_types::ADDR_VERSION_HTLC);
        // Change is native and came after the HTLC output.
        let change = tx.outputs.last().unwrap();
        assert!(change.asset_id.is_none());
        // Redeem witness assembles as [template, preimage, recipient_sig].
        let sighash = SignedTx::sign(
            tx.clone(),
            &kovanica_keys::Keypair::from_secret_bytes([9u8; 32]),
        )
        .unwrap()
        .tx
        .sighash();
        let recipient = kovanica_keys::Keypair::from_secret_bytes({
            let mut b = [0u8; 32];
            b[..8].copy_from_slice(&1u64.to_le_bytes());
            b
        });
        let recipient_sig = recipient.sign(&sighash).0;
        let witness = script.redeem_witness(b"preimage", recipient_sig);
        assert_eq!(witness.len(), 3);
        assert_eq!(witness[0], script.bytes().to_vec());
    }

    #[test]
    fn vault_builder_locks_to_script_address() {
        let script = VaultScript::new(1000, 144, valid_pk(1)).unwrap();
        let tx = VaultBuilder::new(script)
            .network(NetworkId::Testnet)
            .add_input(dummy_utxo(1_000_000_000))
            .amount(Amount::from_atoms(500_000_000))
            .set_fee(Amount::from_atoms(10_000))
            .set_change(test_address(0xBB))
            .build()
            .unwrap();
        let vault_out = &tx.outputs[0];
        assert_eq!(vault_out.value, 500_000_000);
        assert_eq!(vault_out.owner, script.address());
        assert_eq!(
            vault_out.owner.version(),
            kovanica_types::ADDR_VERSION_VAULT
        );
        // Spend witness: [template, owner_sig].
        assert_eq!(script.spend_witness([0x33u8; 64]).len(), 2);
    }

    #[test]
    fn multisig_sign_share_and_attach() {
        let keys: Vec<[u8; 32]> = (1..=3).map(valid_pk).collect();
        let script = MultisigScript::new(2, keys.clone()).unwrap();

        // Build an unsigned P2SH spend via the normal transfer builder.
        let tx = TransferBuilder::new()
            .network(NetworkId::Testnet)
            .add_input(dummy_utxo(1_000_000_000))
            .add_native_output(test_address(0xAA), Amount::from_atoms(900_000_000))
            .set_fee(Amount::from_atoms(10_000))
            .set_change(test_address(0xBB))
            .build()
            .unwrap();
        let mut signer = MultisigSigner::new(tx);

        // Co-signers 1 and 2 sign the same sighash offline.
        let kp1 = kovanica_keys::Keypair::from_secret_bytes({
            let mut b = [0u8; 32];
            b[..8].copy_from_slice(&1u64.to_le_bytes());
            b
        });
        let kp2 = kovanica_keys::Keypair::from_secret_bytes({
            let mut b = [0u8; 32];
            b[..8].copy_from_slice(&2u64.to_le_bytes());
            b
        });
        let share1 = signer.sign_share(&kp1);
        let share2 = signer.sign_share(&kp2);
        assert_eq!(
            share1,
            kp1.sign(&signer.tx.sighash()).0,
            "share must be the Ed25519 sig of the 32-byte sighash"
        );

        signer.attach_witness(&script, &[share1, share2]).unwrap();
        for input in &signer.tx.inputs {
            assert_eq!(input.witness.len(), 3);
            assert_eq!(input.witness[0], script.encode());
            assert_eq!(input.witness[1].len(), 64);
            assert_eq!(input.witness[2].len(), 64);
            // Each signature verifies strictly against the shared sighash.
            let s1 = kovanica_types::Signature(
                input.witness[1].as_slice().try_into().expect("64 bytes"),
            );
            let s2 = kovanica_types::Signature(
                input.witness[2].as_slice().try_into().expect("64 bytes"),
            );
            kp1.verify(&signer.tx.sighash(), &s1).unwrap();
            kp2.verify(&signer.tx.sighash(), &s2).unwrap();
        }
        // Wrong signature count is rejected.
        let mut signer2 = MultisigSigner::new(signer.tx.clone());
        assert!(matches!(
            signer2.attach_witness(&script, &[share1]),
            Err(TxError::Script(_))
        ));
        assert!(signer.tx_hex().len() > 64);
    }
}
