//! Temporary diagnostic: print the authority set the desktop profile derives
//! and its canonical hash, so it can be compared against the live
//! `/api/head.authority_set` reported by the network.

use kovanica_desktop::profile::NetworkProfile;

fn main() {
    let profile = NetworkProfile::testnet();
    let set = profile.authority_set().expect("valid set");
    println!("count     {}", set.len());
    println!("threshold {}", set.threshold());
    for (i, pk) in set.authorities().iter().enumerate() {
        let hex: String = pk.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
        println!("  [{i}] {hex}");
    }
    println!("set hash  {}", hex32(&set.hash()));
}

fn hex32(b: &[u8; 32]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
