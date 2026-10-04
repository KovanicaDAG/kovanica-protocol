//! Kovanica Enterprise Console — Tauri entry point.
//!
//! The shell lives in `kovanica-console-shell`; this file only wires the app's
//! generated context into it.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    kovanica_console_shell::run(tauri::generate_context!());
}
