use criterion::{black_box, criterion_group, criterion_main, Criterion};
use kovanica_dag::Block;
use kovanica_state::{
    apply_block, encode_block_payload, Address, HalvingSchedule, KeyPair, Ledger, OutPoint,
    Transaction, TxOutput,
};

fn coinbase_tx(owner: Address, value: u64) -> Transaction {
    Transaction::coinbase(vec![TxOutput::new(value, owner)], Vec::new())
}

fn transfer_tx(from: &KeyPair, to: Address, input: OutPoint, value: u64) -> Transaction {
    let outputs = vec![TxOutput::new(value, to), TxOutput::new(1, from.address())];
    let tx = Transaction::unsigned(&[input], outputs, Vec::new());
    let sighash = tx.sighash();
    let sig = kovanica_state::Sig::from_bytes(from.sign(&sighash));
    let mut signed = tx;
    signed.attach_signature(0, sig);
    signed
}

fn make_utxo_set() -> (kovanica_state::UtxoSet, KeyPair, Address, OutPoint) {
    let miner = KeyPair::from_u64(1);
    let recipient = KeyPair::from_u64(2).address();
    let cb = coinbase_tx(miner.address(), 1_000_000);
    let outpoint = OutPoint::new(cb.id(), 0);
    let mut utxo = kovanica_state::UtxoSet::default();
    let _summary = apply_block(&mut utxo, &[cb], 0).unwrap();
    (utxo, miner, recipient, outpoint)
}

fn bench_apply_block(c: &mut Criterion) {
    c.bench_function("apply_block_transfer", |b| {
        b.iter_batched(
            || {
                let (utxo, miner, recipient, outpoint) = make_utxo_set();
                let tx = transfer_tx(&miner, recipient, outpoint, 100);
                (utxo, tx)
            },
            |(mut utxo, tx)| {
                let _ = black_box(apply_block(&mut utxo, &[tx], 0));
            },
            criterion::BatchSize::SmallInput,
        )
    });
}

fn build_ledger_chain(n: usize) -> (Ledger, Vec<Block>) {
    let miner = KeyPair::from_u64(1);
    let cb = coinbase_tx(miner.address(), 1_000_000);
    let schedule = HalvingSchedule::new(1000, 500_000);
    let ledger = Ledger::new(3, schedule, &[cb]).unwrap();
    let mut blocks = Vec::with_capacity(n);
    let mut parent = ledger.genesis();
    for i in 0..n {
        let txs = vec![coinbase_tx(miner.address(), ledger.subsidy())];
        let payload = encode_block_payload(&txs);
        let block = Block::new(vec![parent], 1, i as u64 + 1, 0, payload);
        parent = block.id();
        blocks.push(block);
    }
    (ledger, blocks)
}

fn bench_block_validation(c: &mut Criterion) {
    c.bench_function("ledger_insert_prepared_100", |b| {
        b.iter_batched(
            || build_ledger_chain(100),
            |(mut ledger, blocks)| {
                for block in blocks {
                    let _ = black_box(ledger.insert_raw_block(block));
                }
            },
            criterion::BatchSize::SmallInput,
        )
    });
}

criterion_group!(benches, bench_apply_block, bench_block_validation);
criterion_main!(benches);
