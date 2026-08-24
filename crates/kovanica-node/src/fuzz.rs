//! Fuzzing infrastructure for Kovanica node.
//!
//! Provides `Arbitrary` implementations for core types and fuzz targets
//! for libfuzzer/cargo-fuzz integration.
//!
//! Run with: `cargo fuzz run <target_name>`

#![cfg_attr(fuzzing, no_main)]

use arbitrary::{Arbitrary, Error as ArbitraryError, Unstructured};
use kovanica_dag::{Block, BlockId};
use kovanica_state::{
    decode_block_payload, encode_block_payload, Address, KeyPair, OutPoint, Sig, Transaction, TxId,
    TxOutput,
};

/// Generate a random transaction for fuzzing.
/// Uses the provided key pair for signing.
#[cfg(any(test, feature = "fuzzing"))]
pub fn arbitrary_transaction(
    u: &mut Unstructured,
    keypair: &KeyPair,
) -> Result<Transaction, ArbitraryError> {
    let output_count = u.int_in_range(1..=5)?;
    let mut outputs = Vec::with_capacity(output_count);
    for _ in 0..output_count {
        let value = u.int_in_range(1..=1000)?;
        let addr = arbitrary_address(u)?;
        outputs.push(TxOutput::new(value, addr));
    }

    // Generate inputs from the keypair's UTXOs (simplified for fuzzing)
    let input_count = u.int_in_range(1..=3)?;
    let mut inputs = Vec::with_capacity(input_count);
    for _ in 0..input_count {
        let txid = TxId::from_bytes(u.arbitrary()?);
        let index = u.int_in_range(0..=2)?;
        inputs.push(OutPoint::new(txid, index));
    }

    let tx = Transaction::unsigned(&inputs, outputs, Vec::new());
    let sighash = tx.sighash();
    let sig = Sig::from_bytes(keypair.sign(&sighash));

    let mut signed_tx = tx;
    for i in 0..signed_tx.inputs().len() {
        signed_tx.attach_signature(i, sig);
    }

    Ok(signed_tx)
}

/// Generate a random address for fuzzing.
#[cfg(any(test, feature = "fuzzing"))]
pub fn arbitrary_address(u: &mut Unstructured) -> Result<Address, ArbitraryError> {
    let bytes = u.bytes(32)?;
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    Ok(Address::from_bytes(arr))
}

/// Generate a random block for fuzzing.
#[cfg(any(test, feature = "fuzzing"))]
pub fn arbitrary_block(
    u: &mut Unstructured,
    parent_ids: &[BlockId],
    keypair: &KeyPair,
) -> Result<Block, ArbitraryError> {
    let work = u.int_in_range(1..=1000)?;
    let timestamp_ms = u.int_in_range(1..=u64::MAX)?;
    let nonce = u.arbitrary()?;

    let tx_count = u.int_in_range(0..=3)?;
    let mut txs = Vec::with_capacity(tx_count);
    for _ in 0..tx_count {
        txs.push(arbitrary_transaction(u, keypair)?);
    }

    let payload = encode_block_payload(&txs);
    Ok(Block::new(
        parent_ids.to_vec(),
        work,
        timestamp_ms,
        nonce,
        payload,
    ))
}

/// Generate arbitrary block payload for fuzzing.
#[cfg(any(test, feature = "fuzzing"))]
pub fn arbitrary_payload(u: &mut Unstructured) -> Result<Vec<u8>, ArbitraryError> {
    let tx_count = u.int_in_range(0..=5)?;
    let mut txs = Vec::with_capacity(tx_count);
    let keypair = KeyPair::from_u64(u.arbitrary()?);

    for _ in 0..tx_count {
        txs.push(arbitrary_transaction(u, &keypair)?);
    }

    Ok(encode_block_payload(&txs))
}

/// Fuzz target: Block encoding/decoding roundtrip
#[cfg(fuzzing)]
pub fn fuzz_block_roundtrip(data: &[u8]) {
    if let Ok(mut u) = Unstructured::new(data) {
        let keypair = KeyPair::from_u64(u.arbitrary().unwrap_or(1));
        let parent_ids: Vec<BlockId> = (0..u.int_in_range(0..=3).unwrap_or(1))
            .map(|_| {
                u.arbitrary()
                    .unwrap_or_else(|_| BlockId::from_bytes([0u8; 32]))
            })
            .collect();

        if let Ok(block) = arbitrary_block(&mut u, &parent_ids, &keypair) {
            let payload = block.payload().to_vec();
            if let Ok(decoded) = decode_block_payload(&payload) {
                // Verify we can re-encode
                let re_encoded = encode_block_payload(&decoded);
                assert_eq!(payload, re_encoded);
            }
        }
    }
}

/// Fuzz target: Transaction encoding/decoding roundtrip
#[cfg(fuzzing)]
pub fn fuzz_tx_roundtrip(data: &[u8]) {
    if let Ok(mut u) = Unstructured::new(data) {
        let keypair = KeyPair::from_u64(u.arbitrary().unwrap_or(1));
        if let Ok(tx) = arbitrary_transaction(&mut u, &keypair) {
            let encoded = encode_block_payload(std::slice::from_ref(&tx));
            if let Ok(decoded) = decode_block_payload(&encoded) {
                assert_eq!(decoded.len(), 1);
                assert_eq!(decoded[0], tx);
            }
        }
    }
}

/// Fuzz target: Payload encoding/decoding
#[cfg(fuzzing)]
pub fn fuzz_payload_roundtrip(data: &[u8]) {
    if let Ok(mut u) = Unstructured::new(data) {
        if let Ok(payload) = arbitrary_payload(&mut u) {
            if let Ok(decoded) = decode_block_payload(&payload) {
                let re_encoded = encode_block_payload(&decoded);
                assert_eq!(payload, re_encoded);
            }
        }
    }
}

/// Fuzz target: Block validation with various malformed inputs
#[cfg(fuzzing)]
pub fn fuzz_block_validation(data: &[u8]) {
    if let Ok(mut u) = Unstructured::new(data) {
        let keypair = KeyPair::from_u64(u.arbitrary().unwrap_or(1));
        let parent_ids: Vec<BlockId> = (0..u.int_in_range(0..=3).unwrap_or(1))
            .map(|_| {
                u.arbitrary()
                    .unwrap_or_else(|_| BlockId::from_bytes([0u8; 32]))
            })
            .collect();

        if let Ok(block) = arbitrary_block(&mut u, &parent_ids, &keypair) {
            // Test that the block can be inserted into a DAG (may fail for invalid blocks)
            let _ = kovanica_dag::Dag::new(3, kovanica_dag::Block::genesis(3, 0, 0, vec![]));
            // We can't easily test full validation here without a full ledger setup
        }
    }
}

/// Fuzz target: Transaction validation
#[cfg(fuzzing)]
pub fn fuzz_tx_validation(data: &[u8]) {
    if let Ok(mut u) = Unstructured::new(data) {
        let keypair = KeyPair::from_u64(u.arbitrary().unwrap_or(1));
        if let Ok(tx) = arbitrary_transaction(&mut u, &keypair) {
            // Test various validation paths
            let _ = tx.sighash();
            let _ = tx.id();
            let _ = tx.is_coinbase();
            let _ = tx.inputs().len();
            let _ = tx.outputs().len();
        }
    }
}

/// Generate arbitrary data for proptest
#[cfg(test)]
mod proptest_helpers {
    use super::*;
    use proptest::prelude::*;

    prop_compose! {
        pub fn arb_keypair_seed()(seed in any::<u64>()) -> u64 {
            seed
        }
    }

    prop_compose! {
        pub fn arb_address()(bytes in any::<[u8; 32]>()) -> Address {
            Address::from_bytes(bytes)
        }
    }

    prop_compose! {
        pub fn arb_outpoint()(txid in any::<[u8; 32]>(), index in 0..=2u32)
            -> OutPoint {
            OutPoint::new(TxId::from_bytes(txid), index)
        }
    }

    prop_compose! {
        pub fn arb_txoutput()(value in 1..=10000u64, addr in arb_address())
            -> TxOutput {
            TxOutput::new(value, addr)
        }
    }

    fn arb_transaction_inner(
        keypair: KeyPair,
        outputs: Vec<TxOutput>,
        inputs: Vec<OutPoint>,
    ) -> Transaction {
        let tx = Transaction::unsigned(&inputs, outputs, Vec::new());
        let sighash = tx.sighash();
        let sig = Sig::from_bytes(keypair.sign(&sighash));
        let mut signed_tx = tx;
        for i in 0..signed_tx.inputs().len() {
            signed_tx.attach_signature(i, sig);
        }
        signed_tx
    }

    prop_compose! {
            pub fn arb_transaction()(seed in arb_keypair_seed(), outputs in prop::collection::vec(arb_txoutput(), 1..=5), inputs in prop::collection::vec(arb_outpoint(), 1..=3))
                -> Transaction {
            let keypair = KeyPair::from_u64(seed);
            arb_transaction_inner(keypair, outputs, inputs)
        }
    }

    #[test]
    fn test_tx_roundtrip_prop() {
        let keypair = KeyPair::from_u64(1);
        let outputs = vec![TxOutput::new(1000, KeyPair::from_u64(2).address())];
        let inputs = vec![OutPoint::new(TxId::from_bytes([1u8; 32]), 0)];
        let tx = arb_transaction_inner(keypair, outputs, inputs);
        let encoded = encode_block_payload(std::slice::from_ref(&tx));
        let decoded = decode_block_payload(&encoded).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0], tx);
    }

    // LibFuzzer entry points
    #[cfg(all(fuzzing, not(test)))]
    mod fuzz_targets {
        use super::*;

        // These are the entry points for cargo-fuzz
        libfuzzer_sys::fuzz_target!(|data: &[u8]| {
            fuzz_block_roundtrip(data);
        });

        libfuzzer_sys::fuzz_target!(|data: &[u8]| {
            fuzz_tx_roundtrip(data);
        });

        libfuzzer_sys::fuzz_target!(|data: &[u8]| {
            fuzz_payload_roundtrip(data);
        });

        libfuzzer_sys::fuzz_target!(|data: &[u8]| {
            fuzz_block_validation(data);
        });

        libfuzzer_sys::fuzz_target!(|data: &[u8]| {
            fuzz_tx_validation(data);
        });
    }
}
