//! Locking scripts and their spend rules: multisig (RFC-001 / KVP-101),
//! HTLC (RFC-004 / KVP-104) and vault / CSV (RFC-005 / KVP-105).
//!
//! Every struct here is a byte-format port of the corresponding
//! `kovanica-state` module (`multisig.rs`, `htlc.rs`, `vault.rs`) with the
//! same validation rules. Script bytes → BLAKE3 → versioned address matches
//! the node exactly; the parity vectors in
//! `protocol/crates/kovanica-state/tests/script_vectors.rs` pin both sides.

mod htlc;
mod multisig;
mod vault;

pub use htlc::{HtlcError, HtlcScript, HTLC_SCRIPT_LEN};
pub use multisig::{MultisigError, MultisigScript, MAX_MULTISIG_KEYS};
pub use vault::{VaultError, VaultScript, VAULT_TEMPLATE_LEN};
