//! Live genesis-parity spike — the **Slice A gate**, run against the real
//! network.
//!
//! Boots an embedded node using the testnet profile and compares its genesis
//! id byte-for-byte with the live network's (`/api/bootstrap` + `/api/head`).
//! Also reports the `bootstrap` vs `head` subsidy inconsistency the deployed
//! pre-reset chain exposes.
//!
//! Network-dependent — run manually, not in CI:
//!
//! ```sh
//! cd desktop-app
//! cargo run --example genesis_parity_live
//! ```
//!
//! Exit code: 0 = PASS, 1 = FAIL (genesis mismatch), 2 = FAIL (network id
//! mismatch).

use kovanica_desktop::profile::{NetworkProfile, NETWORK_TESTNET};
use kovanica_desktop::service::NodeService;
use serde_json::Value;

const BOOTSTRAP_URL: &str = "https://explorer.kovanica.online/api/bootstrap";
const HEAD_URL: &str = "https://explorer.kovanica.online/api/head";

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bootstrap = fetch_json(BOOTSTRAP_URL)?;
    let head = fetch_json(HEAD_URL)?;

    let live_genesis = str_field(&bootstrap, "genesis");
    let live_network = str_field(&bootstrap, "network");
    let head_genesis = str_field(&head, "genesis");
    let bootstrap_subsidy = json_u64(&bootstrap, "subsidy");
    let head_subsidy = json_u64(&head, "subsidy");

    println!("live /api/bootstrap");
    println!("  network       : {live_network}");
    println!("  genesis       : {live_genesis}");
    println!("  k             : {}", json_u64(&bootstrap, "k"));
    println!("  subsidy       : {bootstrap_subsidy}  (reported genesis subsidy)");
    println!(
        "  founder_amount: {}",
        json_u64(&bootstrap, "founder_amount")
    );
    println!("  founder_seed  : {}", json_u64(&bootstrap, "founder_seed"));
    println!(
        "  finality      : {}",
        json_u64(&bootstrap, "finality_depth")
    );
    println!(
        "  pruning       : {}",
        json_u64(&bootstrap, "payload_pruning_depth")
    );
    println!("live /api/head");
    println!("  genesis       : {head_genesis}");
    println!("  blocks        : {}", json_u64(&head, "blocks"));
    println!("  subsidy       : {head_subsidy}  (running schedule subsidy)");

    if head_subsidy != 0 && bootstrap_subsidy != head_subsidy {
        println!(
            "WARN: /api/bootstrap subsidy ({bootstrap_subsidy}) != /api/head subsidy \
             ({head_subsidy}); the seed is RFC-006-era code serving a pre-reset chain. \
             The chain's genesis (not the bootstrap light_config) is authoritative."
        );
    }

    if live_network != NETWORK_TESTNET {
        eprintln!(
            "FAIL: live network id '{live_network}' != expected '{NETWORK_TESTNET}'. \
             This app only targets the network its genesis profile describes."
        );
        std::process::exit(2);
    }

    let mut service = NodeService::new(NetworkProfile::testnet());
    let (local_genesis, founder) = service.boot()?;
    println!("embedded node");
    println!("  genesis       : {local_genesis}");
    println!("  founder       : {founder}");
    println!("  blocks        : {}", service.block_count());

    service.verify_genesis_parity(live_genesis)?;
    println!("PASS: embedded node genesis == live network genesis");

    if head_genesis == live_genesis {
        println!("PASS: /api/bootstrap and /api/head agree on genesis");
    } else {
        println!("WARN: /api/bootstrap genesis != /api/head genesis ({head_genesis})");
    }
    Ok(())
}

fn fetch_json(url: &str) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let resp = ureq::get(url).call().map_err(|e| format!("{url}: {e}"))?;
    let text = resp.into_string().map_err(|e| format!("{url}: {e}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("{url} returned non-JSON: {e}\n{text}"))?;
    Ok(value)
}

fn json_u64(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or_default()
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .trim()
}
