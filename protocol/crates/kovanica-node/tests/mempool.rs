//! Integration tests for the mempool and block production.
//!
//! These drive the `Node` API directly rather than the `rpc` string surface.
//! The RPC `genesis` command builds a non-PoA genesis, and since PoA is the
//! only admission regime (RFC-POA §0) such a node can never produce — the
//! `rpc` surface has no PoA genesis / authority-key command yet. See
//! `docs/RFC-POA-Migration.md` §0.9 (blockers B1/B2).

use ed25519_dalek::SigningKey;
use kovanica_dag::{AuthorityPublicKey, AuthoritySet};
use kovanica_node::Node;
use kovanica_state::KeyPair;

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;
/// Authority count. The `AuthoritySet` minimum is 3; this suite uses 5 so that
/// one seed can be reserved as a dedicated block producer that none of the
/// transfer assertions below touch.
const AUTHORITIES: u64 = 5;
/// Seed reserved as the block producer. Every block subsidy lands here, so the
/// mempool assertions on actors 1..=4 stay free of subsidy arithmetic.
const PRODUCER_SEED: u64 = 5;

fn authority_key(seed: u64) -> AuthorityPublicKey {
    SigningKey::from_bytes(&KeyPair::from_u64(seed).seed()).verifying_key()
}

fn poa_authority_set() -> AuthoritySet {
    let keys: Vec<AuthorityPublicKey> = (1..=AUTHORITIES).map(authority_key).collect();
    AuthoritySet::new(keys, 2).expect("valid authority set")
}

/// A clock pin that makes the block subsidy land on [`PRODUCER_SEED`].
///
/// Genesis is stamped at `0`, so a produced block's timestamp is
/// `max(now_ms, 1)` (see `Node::next_timestamp`) and its slot is
/// `timestamp / SLOT_MS`. `AuthoritySet` stores authorities in ascending
/// public-key encoding — *not* in the order they were supplied — so which seed
/// owns a given slot has to be looked up, never assumed.
fn pin_scheduling_producer(set: &AuthoritySet) -> u64 {
    let slot = (0..AUTHORITIES)
        .find(|slot| *set.active_authority(*slot) == authority_key(PRODUCER_SEED))
        .expect("producer seed is a member of the set");
    // `slot == 0` needs a pin of at least 1, since genesis is stamped at 0.
    slot * SLOT_MS + 1
}

/// A PoA node holding every authority signing key, so it produces in any
/// slot. With the clock pinned by [`pin_scheduling_producer`], the subsidy is
/// credited to [`PRODUCER_SEED`] (seed 5) on every block, and the transfer
/// assertions below only involve actors 1..=4.
fn poa_node(subsidy: u64, premine: u64) -> Node {
    let set = poa_authority_set();
    let mut node = Node::new();
    node.set_now_ms(pin_scheduling_producer(&set));
    node.genesis_with_poa(
        3,
        subsidy,
        premine,
        1,
        None,
        u64::MAX,
        u64::MAX,
        u64::MAX,
        None,
        set,
        SLOT_MS,
    )
    .expect("genesis");
    for seed in 1..=AUTHORITIES {
        node.set_authority_signing_key(KeyPair::from_u64(seed).seed());
    }
    node
}

fn bal(node: &mut Node, seed: u64) -> u128 {
    node.balance(&Node::address(seed)).unwrap()
}

#[test]
fn a_pooled_transfer_is_packed_into_a_block() {
    let mut node = poa_node(1000, 1000);
    node.pool(1, 400, 2).unwrap();
    assert_eq!(node.pending_count(), 1);

    assert!(node.produce_block().unwrap().is_some());
    assert_eq!(node.pending_count(), 0);
    assert_eq!(bal(&mut node, 2), 400);
    // 599 change (1000 - 400 - 1 fee). The 1000 KVNC subsidy is credited to
    // the slot-scheduled producer (seed 5), not to the spender.
    assert_eq!(bal(&mut node, 1), 599);
    assert_eq!(bal(&mut node, 5), 1000);
    assert_eq!(node.block_count().unwrap(), 2); // genesis + produced block
}

#[test]
fn non_conflicting_entries_from_two_actors_pack_together() {
    let mut node = poa_node(1000, 1000);
    // Fund actor 2 immediately so two actors each have a spendable output.
    node.send(1, 500, 2).unwrap();
    // Now pool spends from each (different outputs — no conflict).
    node.pool(1, 100, 3).unwrap();
    node.pool(2, 100, 4).unwrap();
    assert_eq!(node.pending_count(), 2);

    assert!(node.produce_block().unwrap().is_some());
    assert_eq!(node.pending_count(), 0);
    // 398 change (499 - 100 - 1 fee). The 1000 KVNC subsidy coinbase goes to
    // the producer, so actors 1..=4 show transfer arithmetic only.
    assert_eq!(bal(&mut node, 1), 398);
    assert_eq!(bal(&mut node, 2), 399); // 500 - 100 - 1 fee
    assert_eq!(bal(&mut node, 3), 100);
    assert_eq!(bal(&mut node, 4), 100);
    assert_eq!(bal(&mut node, 5), 1000);
}

#[test]
fn conflicting_pool_entries_are_partially_included() {
    // Both pooled transfers spend actor 1's single 1000 output, so only one can
    // be included. The loser is then evicted: its input is gone from the
    // selected-tip UTXO, so it can never apply on this branch.
    let mut node = poa_node(1000, 1000);
    node.pool(1, 400, 2).unwrap();
    node.pool(1, 300, 3).unwrap();
    assert_eq!(node.pending_count(), 2);

    assert!(node.produce_block().unwrap().is_some());
    let (b2, b3) = (bal(&mut node, 2), bal(&mut node, 3));
    assert!((b2 == 400 && b3 == 0) || (b2 == 0 && b3 == 300));
    assert_eq!(bal(&mut node, 5), 1000); // subsidy went to the producer
    assert_eq!(node.pending_count(), 0);

    assert!(node.produce_block().unwrap().is_none());
    assert_eq!(node.pending_count(), 0);
}

#[test]
fn producing_from_an_empty_mempool_is_a_noop() {
    let mut node = poa_node(1000, 500);
    assert!(node.produce_block().unwrap().is_none());
    assert_eq!(node.block_count().unwrap(), 1);
}
