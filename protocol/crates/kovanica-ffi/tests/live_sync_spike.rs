//! Slice-9a spike: can a phone `LightNode` import the LIVE kovanica testnet
//! chain? The whole app depends on the FFI node reproducing the network
//! genesis — if local genesis diverges, `receive_blocks` cannot anchor.
//!
//! Fixture `tests/fixtures/live-alpha-blocks.bin` is a capture of the first 9
//! post-genesis records of `GET /api/blocks` from seed1 (the public testnet
//! node; re-captured 2026-09-14 for the RFC-006 chain). Constants below were
//! read from `GET /api/bootstrap` on the same host:
//!   genesis 9565fc20…, k=3, subsidy 10 KVNC, premine 200_000 KVNC
//!   (RFC006_PREMINE), founder_seed 1, `kovanica-testnet`.
//!
//! If this test starts failing off the fixture, re-capture the endpoint and
//! revisit the genesis config — the network may have booted a new chain.
//!
//! ⚠️ PoA (RFC-POA-Migration) M1: `Block::compute_id` now hashes the
//! authority-signature flag byte, so every block id — including genesis —
//! changed. The live testnet has not reset yet, so local genesis no longer
//! matches the live network. Same precedent as RFC-003 stealth.
//!
//! Neither test below can be pinned to a post-reset value yet, and the reason
//! is structural rather than "we forgot":
//!
//!   * `live_params_reproduce_testnet_genesis` boots a `LightNode` and compares
//!     its genesis against `LIVE_GENESIS`. `LightNode` derives genesis through
//!     `Node::genesis_with_poa`, which folds a **PoA authority set** into the
//!     genesis. So it cannot borrow the constant pinned in `kovanica-node`'s
//!     `treasury.rs` — that one comes from `Node::genesis`, which passes
//!     `authority_set: None` and therefore produces a *different* id from an
//!     identical allocation.
//!   * The real post-reset value is **not yet knowable**: RFC-POA-Migration
//!     §0.9's authority-key ceremony is still `[OPEN]`, so the keys the live
//!     genesis will carry do not exist. Substituting placeholder keys and
//!     pinning that would be precisely the false green this file exists to
//!     catch.
//!
//! So `LIVE_GENESIS` stays a **pre-reset capture**, kept because `LIVE_TIP` and
//! `tests/fixtures/live-alpha-blocks.bin` descend from it. When the ceremony
//! lands, re-capture genesis and blocks from `/api/head` + `/api/blocks` and
//! move all three together.

use kovanica_ffi::{LightConfig, LightNode};

/// Genesis of the **pre-reset** testnet chain, captured from
/// `GET /api/bootstrap` on 2026-09-14. See the module header for why this
/// cannot simply be moved forward, and what must be re-captured together with
/// it once RFC-POA-Migration §0.9's authority-key ceremony lands.
const LIVE_GENESIS: &str = "9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97";
const LIVE_TIP: &str = "c62cd17cd79762036f1ae5f6dd0bba3d7c1aa437082d7199965bd3075cd3d154";
const LIVE_BLOCKS: u32 = 10;
const ATOM: u64 = 100_000_000;

fn fixture_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("live-alpha-blocks.bin")
}

/// The PoA authority set the post-reset testnet is expected to run. ⚠️ These
/// are the **placeholder** keys (`AUTHORITY_PLACEHOLDER_BASE = 9001`, 2-of-3),
/// not real ceremony output — the PoA testnet reset must generate real random
/// keys and the constants here must be re-captured then (RFC-POA-Migration
/// §0.9 / the authority-key ceremony, still `[OPEN]`). A real network will
/// never match this set, so `live_params_reproduce_testnet_genesis` cannot pass
/// until it is re-captured.
fn placeholder_authority_hex() -> Vec<String> {
    // Derived exactly as `kovanica-node`'s placeholder set does, so these
    // really are the network's `AUTHORITY_PLACEHOLDER_BASE = 9001` keys.
    (0..3u64)
        .map(|i| {
            hex::encode(
                kovanica_state::KeyPair::from_u64(9001 + i)
                    .address()
                    .payload(),
            )
        })
        .collect()
}

fn live_config() -> LightConfig {
    LightConfig {
        k: 3,
        subsidy: 10 * ATOM,             // RFC-006 genesis subsidy (10 KVNC)
        founder_amount: 200_000 * ATOM, // RFC006_PREMINE (200_000 KVNC)
        founder_seed: 1,
        finality_depth: 100,
        payload_pruning_depth: 1000,
        authority_public_keys: placeholder_authority_hex(),
        authority_threshold: 0, // strict majority of 3 = 2
        slot_duration_ms: kovanica_dag::SLOT_DURATION_MS,
    }
}

#[test]
fn default_config_genesis_diverges_from_live_network() {
    // The FFI default (subsidy 1000, premine 1000) does NOT reproduce the
    // live network: its genesis block id differs from the testnet genesis.
    let config = LightConfig {
        authority_public_keys: placeholder_authority_hex(),
        ..LightConfig::default()
    };
    let node = LightNode::new(config).expect("genesis ok");
    assert!(node
        .block_by_id(LIVE_GENESIS.to_string())
        .unwrap()
        .is_none());
}

#[test]
fn authority_set_is_part_of_the_genesis_identity() {
    // The authority set is hashed into the genesis coinbase, so it is part of
    // the chain identity, not a runtime policy knob. Two nodes built with
    // different authority sets derive different genesis ids and will not accept
    // each other's blocks — which is what makes "a light node must know the
    // authority set" a correctness requirement rather than a nicety.
    let one = LightNode::new(live_config()).expect("genesis ok");

    let mut other = live_config();
    let mut keys = other.authority_public_keys.clone();
    // Swapping order is not enough — `AuthoritySet::new` canonicalises by
    // ascending public-key bytes — so replace a key with a real Ed25519 point
    // that is not in the set (a fourth placeholder key).
    keys[0] = hex::encode(kovanica_state::KeyPair::from_u64(9004).address().payload());
    other.authority_public_keys = keys;
    let two = LightNode::new(other).expect("genesis ok");

    assert_ne!(
        one.selected_tip().unwrap(),
        two.selected_tip().unwrap(),
        "a different authority set must yield a different genesis"
    );
}

#[test]
#[ignore = "LightNode derives genesis via genesis_with_poa, so it cannot match the authority_set:None constant pinned in kovanica-node/tests/treasury.rs; the real post-reset value needs RFC-POA-Migration §0.9's authority keys, still [OPEN]"]
fn live_params_reproduce_testnet_genesis() {
    let node = LightNode::new(live_config()).expect("genesis ok");
    assert_eq!(node.balance_of_seed(1).unwrap(), "20000000000000");
    // Genesis parity without syncing: the local node booted to the same
    // genesis block the public network anchors on.
    let genesis = node
        .block_by_id(LIVE_GENESIS.to_string())
        .unwrap()
        .expect("phone genesis must equal live network genesis");
    assert_eq!(genesis.id_hex, LIVE_GENESIS);
}

#[test]
#[ignore = "fixture live-alpha-blocks.bin is a pre-reset capture descending from genesis 9565fc20…; re-capture from /api/blocks after the PoA testnet reset, then update LIVE_TIP"]
fn light_node_imports_live_testnet_chain() {
    let node = LightNode::new(live_config()).expect("genesis ok");
    let blob = std::fs::read(fixture_path()).expect("fetch tests/fixtures and commit it");
    let applied = node.receive_blocks(blob).expect("blob must decode");
    assert!(applied > 0, "expected the blob to apply records");

    // Converged on the live chain: full DAG size, selected tip and a
    // present tip block all match `GET /api/state` / `/api/bootstrap`.
    assert_eq!(node.block_count().unwrap(), LIVE_BLOCKS);
    assert_eq!(node.selected_tip().unwrap(), LIVE_TIP);
    assert!(node.block_by_id(LIVE_TIP.to_string()).unwrap().is_some());
}
