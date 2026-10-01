//! Kovanica Desktop Node App — Tauri entry point.

#[cfg(feature = "tauri")]
fn main() {
    kovanica_desktop::tauri_main::run();
}

#[cfg(not(feature = "tauri"))]
fn main() {
    eprintln!("Tauri feature not enabled. Build with --features tauri to run the desktop app.");
    std::process::exit(1);
}
