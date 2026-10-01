//! Throwaway probe: reproduce the live testnet genesis id from candidate
//! construction paths. Network-independent.
//!
//! **PoA is the only admission regime** (RFC-POA-Migration §0, ratified
//! 2026-09-25). The live chain is the RFC-006-era parameter set booted through
//! `Node::genesis_with_poa` with the 3-key TESTNET-ONLY deterministic authority
//! set at threshold 2 and 3000 ms slots. Under PoA the genesis coinbase tag is
//! `KVA1 || authority_set_hash`, so **the genesis id commits to the authority
//! set** — booting with a different set derives a different genesis.
//!
//! Candidate **A** therefore goes through `NetworkProfile::testnet()` and
//! `NodeService::boot()` — the real production path, not a hand-rolled copy —
//! so a drift in either the profile or the service shows up here.
//!
//! Candidates **B** and **C** are historical, kept so a future reader can tell
//! a stale-constant regression from a real reset. Both are obsolete: **B** is
//! the RFC-006-era but pre-PoA chain (coinbase tag `b"genesis"`), **C** is the
//! pre-RFC-006-era chain (200 KVNC subsidy/premine, no treasury).

use kovanica_desktop::profile::NetworkProfile;
use kovanica_desktop::service::NodeService;

const LIVE_GENESIS: &str = "08fa538f2e5963bebcf202bee37075bb6b7cf3d0934598888127a20c0a952b4b";
const ATOM: u64 = 100_000_000;

/// Legacy pre-PoA construction (obsolete): no authority set, coinbase tag
/// `b"genesis"`. Kept for regression triage only — never the live path.
///
/// The operator-wallet argument is `None` here (as in the pre-PoA original):
/// the operator wallet is not part of the genesis coinbase, so it cannot affect
/// the id this probe compares.
fn boot_legacy_pre_poa(
    subsidy: u64,
    premine: u64,
    treasury: Option<kovanica_node::TreasuryGenesis>,
) -> String {
    let mut node = kovanica_node::Node::new();
    let (genesis, _founder) = node
        .genesis_with_finality(3, subsidy, premine, 1, treasury, 100, 1000, 1000, None)
        .expect("legacy genesis boots");
    genesis.to_string()
}

fn verdict(id: &str) -> &'static str {
    if id == LIVE_GENESIS {
        "MATCH"
    } else {
        "no"
    }
}

fn main() {
    println!("target  {}", LIVE_GENESIS);

    println!("A) PoA genesis via NetworkProfile::testnet() (LIVE)");
    let mut service = NodeService::new(NetworkProfile::testnet());
    let (a, _founder) = service.boot().expect("profile boots under PoA");
    println!("   => {a}  {}", verdict(&a));

    println!("B) RFC-006-era, pre-PoA coinbase tag (OBSOLETE)");
    let b = boot_legacy_pre_poa(
        10 * ATOM,
        200_000 * ATOM,
        Some(kovanica_node::TreasuryGenesis::placeholder()),
    );
    println!("   => {b}  {}", verdict(&b));

    println!("C) Old pre-RFC-006-era (OBSOLETE)");
    let c = boot_legacy_pre_poa(200 * ATOM, 200 * ATOM, None);
    println!("   => {c}  {}", verdict(&c));
}
