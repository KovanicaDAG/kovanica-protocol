//! Live testnet integration tests (S-11).
//!
//! Gated behind the `live-testnet` feature so `cargo test --workspace` stays
//! offline. Run with:
//!
//! ```bash
//! cargo test -p kovanica-rpc --features live-testnet -- --nocapture
//! ```
//!
//! Base URL: `KOVANICA_API` env override, else `https://api.kovanica.online`.
//!
//! Every assertion is checked against a live `GET /api/head` +
//! `GET /api/bootstrap` before being written:
//! - `atom = 1e8`, `subsidy = 1e9` (era 0: s0 = 10 KVNC),
//!   `max_supply = 9_020_000_000_000_000` (RFC-006),
//! - `min_fee = 2000` (era 0 floor: `max(1, 1e9 / 500_000)` atoms/byte),
//! - `k = 3` (GHOSTDAG), `token = "KVNC"`,
//! - peer list uses DNS seed names on TCP 9000 (no orange-cloud hosts).
//!
//! These tests are **read-only** except one deliberately-invalid
//! `/api/submit_tx` probe (an empty transaction) that must be rejected —
//! no keys, no funded spends, no faucet usage.

#![cfg(feature = "live-testnet")]

use kovanica_rpc::{Client, RpcError};
use kovanica_types::{Address, NetworkId, Transaction};

/// RFC-006 hard cap: 90.2M KVNC in atoms.
///
/// Source of truth: `kovanica-state/src/ledger.rs` `MAX_SUPPLY = 90_200_000 *
/// ATOM` = 9_020_000_000_000_000, live-confirmed via `/api/bootstrap`
/// (`max_supply`). (Docs that print `90_200_000_000_000_000` carry one extra
/// zero; the consensus constant and the live node agree on 9.02e15.)
const MAX_SUPPLY_ATOMS: u64 = 9_020_000_000_000_000;
/// Era-0 block subsidy: 10 KVNC in atoms (era length is 2M blocks; the
/// live tip has far fewer, so era 0 is stable for these tests).
const ERA0_SUBSIDY_ATOMS: u64 = 1_000_000_000;
/// Era-0 fee floor: `max(1, subsidy / 500_000)` atoms/byte.
const ERA0_MIN_FEE: u64 = 2_000;
/// Atoms per KVNC.
const ATOMS_PER_KVNC_LIVE: u64 = 100_000_000;

fn client() -> Client {
    let base =
        std::env::var("KOVANICA_API").unwrap_or_else(|_| kovanica_rpc::DEFAULT_API_BASE.into());
    Client::new(base).expect("client")
}

fn is_64_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[tokio::test]
async fn live_head_matches_rfc006_baseline() {
    let head = client().get_head().await.expect("GET /api/head");
    assert_eq!(head.network, "kovanica-testnet");
    assert_eq!(
        head.atom,
        Some(ATOMS_PER_KVNC_LIVE),
        "atom scale must be 1e8"
    );
    assert!(
        head.blocks.unwrap_or(0) > 0,
        "testnet must be producing blocks"
    );
    let genesis = head.genesis.expect("genesis field");
    let tip = head.tip.expect("tip field");
    assert!(is_64_hex(&genesis), "genesis must be 64-hex");
    assert!(is_64_hex(&tip), "tip must be 64-hex");
    // Era-0 floor (RFC-006): max(1, 10 KVNC / 500_000) = 2000 atoms/byte.
    assert_eq!(head.min_fee, Some(ERA0_MIN_FEE), "RFC-006 era-0 fee floor");
    // If the node advertises subsidy, the fee floor must agree with it.
    if let Some(subsidy) = head.subsidy {
        let expected = std::cmp::max(1, subsidy / 500_000);
        assert_eq!(head.min_fee, Some(expected), "min_fee must follow RFC-006");
    }
}

#[tokio::test]
async fn live_bootstrap_enforces_consensus_invariants() {
    let boot = client().get_bootstrap().await.expect("GET /api/bootstrap");
    assert_eq!(boot.network.as_deref(), Some("kovanica-testnet"));
    assert_eq!(boot.k, Some(3), "GHOSTDAG k must be 3");
    assert_eq!(boot.token.as_deref(), Some("KVNC"));
    assert_eq!(boot.atom, Some(ATOMS_PER_KVNC_LIVE));
    assert_eq!(
        boot.max_supply,
        Some(MAX_SUPPLY_ATOMS),
        "RFC-006 hard cap (90.2M KVNC)"
    );
    // Era-0 subsidy (era length 2M blocks — live tip is far below that).
    if let Some(subsidy) = boot.subsidy {
        assert_eq!(subsidy, ERA0_SUBSIDY_ATOMS, "era-0 subsidy = 10 KVNC");
    }

    // Supply accounting: never exceed the cap, circulating never exceeds total.
    let minted = boot.native_minted.unwrap_or(0);
    assert!(
        minted <= MAX_SUPPLY_ATOMS,
        "minted must respect the 90.2M cap"
    );
    if let Some(total) = boot.total {
        assert_eq!(total, minted, "total supply must equal cumulative minted");
        if let Some(circulating) = boot.circulating {
            assert!(circulating <= total, "circulating must not exceed total");
        }
    }

    // P2P seed policy: DNS seed names on TCP 9000 only — never an
    // orange-cloud explorer host (it proxies TCP and breaks gossip).
    assert!(!boot.peers.is_empty(), "bootstrap must advertise peers");
    for peer in &boot.peers {
        assert!(
            !peer.starts_with("explorer.kovanica.online"),
            "never dial an orange-cloud host over TCP: {peer}"
        );
        assert!(
            peer.ends_with(":9000"),
            "Kovanica P2P listens on TCP 9000 only: {peer}"
        );
    }
}

#[tokio::test]
async fn live_utxos_empty_for_fresh_address() {
    // Legacy 64-hex (bare pubkey) → P2PK address that has never received funds.
    let addr = Address::p2pk([0xAAu8; 32]);
    let res = client()
        .get_utxos(&addr, Some(5), Some(0))
        .await
        .expect("GET /api/utxos");
    assert_eq!(
        res.balance, 0,
        "fresh address must have zero native balance"
    );
    assert!(res.utxos.is_empty(), "fresh address must have no UTXOs");
    assert_eq!(res.total, 0);
    assert_eq!(res.address, addr.to_hex(), "node must echo 66-hex form");
    assert_eq!(res.limit, 5);
    assert_eq!(res.offset, 0);
}

#[tokio::test]
async fn live_fee_estimate_shape() {
    let fee = client()
        .get_fee_estimate()
        .await
        .expect("GET /api/fee_estimate");
    assert_eq!(fee.unit, "atoms/byte");
    // fee_rate is 0 while the mempool is empty (verified live), otherwise a
    // real rate; it must never be advertised below the RFC-006 floor when
    // there is demand to price.
    if fee.mempool > 0 {
        assert!(fee.fee_rate >= 1, "non-empty mempool must price above zero");
    }
}

#[tokio::test]
async fn live_submit_rejects_empty_transaction() {
    // A transaction with no inputs/outputs is decodable but consensus-invalid;
    // the node must reject it. Deliberately malformed probe — spends nothing,
    // uses no keys, and cannot be accepted.
    let empty = Transaction::new(NetworkId::Testnet, Vec::new(), Vec::new(), Vec::new());
    let probe = kovanica_tx::SignedTx { tx: empty };
    let err = client()
        .submit_tx(&probe)
        .await
        .expect_err("node must reject an empty transaction");
    // Surface whatever the node said so failures are diagnosable.
    match err {
        RpcError::Api(msg) | RpcError::Decode(msg) => {
            println!("node rejected empty tx as expected: {msg}");
        }
        other => panic!("unexpected error kind for rejected tx: {other:?}"),
    }
}
