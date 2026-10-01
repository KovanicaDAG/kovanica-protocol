//! Fee-market integration tests: fee-rate eviction, RBF, and the fee estimate
//! endpoint.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::num::NonZeroUsize;

use ed25519_dalek::SigningKey;
use kovanica_dag::{AuthorityPublicKey, AuthoritySet};
use kovanica_node::explorer::{handle, Explorer};
use kovanica_node::{MempoolConfig, Node};
use kovanica_state::{KeyPair, OutPoint, Transaction, TxOutput};

fn send_req(app: &mut Explorer, req: &str) -> (u16, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut client = TcpStream::connect(addr).unwrap();
    let (server_stream, _) = listener.accept().unwrap();

    client.write_all(req.as_bytes()).unwrap();
    client.shutdown(std::net::Shutdown::Write).unwrap();

    let _ = handle(app, server_stream);

    let mut resp = Vec::new();
    let _ = client.read_to_end(&mut resp);
    let resp_str = String::from_utf8_lossy(&resp).to_string();

    let status = resp_str
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);

    let body = if let Some(pos) = resp_str.find("\r\n\r\n") {
        resp_str[pos + 4..].to_string()
    } else {
        String::new()
    };
    (status, body)
}

fn tx_spending(op: OutPoint, _input_value: u64, output_value: u64) -> Transaction {
    let kp = KeyPair::from_u64(1);
    Transaction::signed(
        &[(op, &kp)],
        vec![TxOutput::native(output_value, kp.address())],
        vec![],
    )
}

fn actor1_utxos(node: &Node) -> Vec<(OutPoint, u64)> {
    node.utxos_of(&Node::address(1)).unwrap()
}

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;
/// Authority seeds for [`poa_node_producing_for_actor1`].
const FEE_MARKET_AUTHORITIES: u64 = 3;

/// A clock pin that lands every produced block in the slot scheduled to
/// `seed`.
///
/// Genesis is stamped at `0`, so a produced block's timestamp is
/// `max(now_ms, 1)` (see `Node::next_timestamp`) and its slot is
/// `timestamp / SLOT_MS`. Consecutive `produce_empty` calls then advance the
/// timestamp by one millisecond each, which stays inside the same slot.
fn pin_scheduling(set: &AuthoritySet, seed: u64) -> u64 {
    let key = SigningKey::from_bytes(&KeyPair::from_u64(seed).seed()).verifying_key();
    let slot = (0..FEE_MARKET_AUTHORITIES)
        .find(|slot| *set.active_authority(*slot) == key)
        .expect("seed is a member of the authority set");
    // `slot == 0` needs a pin of at least 1, since genesis is stamped at 0.
    slot * SLOT_MS + 1
}

/// A PoA node whose block rewards are credited to `Node::address(1)`.
///
/// Under PoA the coinbase pays a *slot-scheduled* authority, not the genesis
/// founder and not the first key loaded. Two details make that recipient
/// non-obvious:
///
/// - `AuthoritySet::new` sorts authorities into ascending public-key encoding,
///   so `authorities[0]` is not necessarily the first seed supplied.
/// - The scheduled authority is `active_authority(timestamp / SLOT_MS)`, so
///   the recipient depends on the wall clock and changes every slot.
///
/// Genesis is stamped at `0`, so pinning the clock before genesis fully
/// determines every produced block's timestamp — and therefore its slot. We
/// pin to the slot that schedules seed 1, keeping every reward on actor 1 and
/// leaving the suite's spends/signs valid. `pin_scheduling` looks the slot up
/// rather than assuming one, and stays within a single slot across consecutive
/// `produce_empty` calls, so repeated blocks remain deterministic.
fn poa_node_producing_for_actor1(config: MempoolConfig) -> Node {
    let keys: Vec<AuthorityPublicKey> = (1..=FEE_MARKET_AUTHORITIES)
        .map(|i| SigningKey::from_bytes(&KeyPair::from_u64(i).seed()).verifying_key())
        .collect();
    let set = AuthoritySet::new(keys, 2).expect("valid authority set");
    let mut node = Node::with_mempool_config(config);
    node.set_now_ms(pin_scheduling(&set, 1));
    node.genesis_with_poa(
        3,
        100_000,
        100_000,
        1,
        None,
        u64::MAX,
        u64::MAX,
        u64::MAX,
        None,
        set,
        SLOT_MS,
    )
    .unwrap();
    for i in 1..=FEE_MARKET_AUTHORITIES {
        node.set_authority_signing_key(KeyPair::from_u64(i).seed());
    }
    node
}

#[test]
fn fee_rate_eviction_drops_lowest_rate_tx() {
    let config = MempoolConfig {
        max_txs: Some(NonZeroUsize::new(2).unwrap()),
        max_bytes: None,
        min_fee_rate: 0,
        ..Default::default()
    };
    let mut node = poa_node_producing_for_actor1(config);

    // Produce two empty blocks to create additional actor-1 UTXOs.
    node.produce_empty().unwrap();
    node.produce_empty().unwrap();

    let mut utxos = actor1_utxos(&node);
    utxos.sort_by_key(|(_, v)| *v);
    utxos.reverse();
    assert!(utxos.len() >= 3, "need at least 3 utxos");

    let (op1, v1) = utxos[0];
    let (op2, v2) = utxos[1];
    let (op3, v3) = utxos[2];

    let tx_low = tx_spending(op1, v1, v1 - 1_000);
    let tx_mid = tx_spending(op2, v2, v2 - 10_000);
    let tx_high = tx_spending(op3, v3, v3 - 20_000);

    node.submit_tx(tx_low.clone()).unwrap();
    node.submit_tx(tx_mid.clone()).unwrap();

    // Adding the high-fee tx should evict the lowest-fee tx.
    node.submit_tx(tx_high.clone()).unwrap();

    assert_eq!(node.pending_count(), 2);
    assert!(!node.mempool_tx(&tx_low.id()).is_some());
    assert!(node.mempool_tx(&tx_mid.id()).is_some());
    assert!(node.mempool_tx(&tx_high.id()).is_some());
}

#[test]
fn replace_by_fee_succeeds_with_bump() {
    let config = MempoolConfig {
        min_fee_rate: 0,
        ..Default::default()
    };
    let mut node = Node::with_mempool_config(config);
    node.genesis(3, 100_000, 100_000, 1, None).unwrap();

    let utxos = actor1_utxos(&node);
    let (op, value) = utxos[0];

    let tx1 = tx_spending(op, value, value - 1_000);
    node.submit_tx(tx1.clone()).unwrap();

    let tx2 = tx_spending(op, value, value - 10_000);
    node.replace_by_fee(tx2.clone(), 1).unwrap();

    assert!(!node.mempool_tx(&tx1.id()).is_some());
    assert!(node.mempool_tx(&tx2.id()).is_some());
}

#[test]
fn replace_by_fee_rejects_insufficient_bump() {
    let config = MempoolConfig {
        min_fee_rate: 0,
        ..Default::default()
    };
    let mut node = Node::with_mempool_config(config);
    node.genesis(3, 100_000, 100_000, 1, None).unwrap();

    let utxos = actor1_utxos(&node);
    let (op, value) = utxos[0];

    let tx1 = tx_spending(op, value, value - 10_000);
    node.submit_tx(tx1.clone()).unwrap();

    // Lower fee rate; no bump.
    let tx2 = tx_spending(op, value, value - 5_000);
    let err = node.replace_by_fee(tx2.clone(), 1).unwrap_err();
    assert!(err.to_string().contains("insufficient fee bump"));

    assert!(node.mempool_tx(&tx1.id()).is_some());
    assert!(!node.mempool_tx(&tx2.id()).is_some());
}

#[test]
fn fee_estimate_endpoint_returns_rate() {
    let mut app = Explorer::boot();
    app.producing = false;

    let (status, body) = send_req(
        &mut app,
        "GET /api/fee_estimate HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
    );
    assert_eq!(status, 200, "body: {}", body);

    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(json["fee_rate"].as_u64().is_some());
    assert_eq!(json["unit"].as_str(), Some("atoms/byte"));
    assert!(json["mempool"].as_u64().is_some());
    assert!(json["bytes"].as_u64().is_some());
}
