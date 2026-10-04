fn main() {
    // Tauri's context codegen is only needed for the desktop shell (`tauri`
    // feature). The default build (worker crate + CLI entry) must not require
    // tauri-build's codegen, which panics on a missing `cargo:dev` when the
    // tauri feature is off.
    if std::env::var_os("CARGO_FEATURE_TAURI").is_some() {
        tauri_build::build();
    }
}
