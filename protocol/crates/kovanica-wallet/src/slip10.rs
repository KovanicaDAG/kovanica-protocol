//! The **frozen** Kovanica key-derivation path: SLIP-0010 ed25519 over
//! `m/44'/3007'/0'/0'/i'`.
//!
//! # Canonical implementation lives in the SDK
//!
//! The algorithm is implemented once, in the published SDK crate
//! [`kovanica_keys::slip10`] (see `docs/unify/DECISIONS.md`). This module is a
//! thin re-export so the protocol tree keeps its existing import paths —
//! `kovanica_wallet::slip10::derive_ed25519` — while the node, the CLI, and
//! the FFI binding all derive the same bytes as the web wallet, the mobile
//! apps, and the wasm binding.
//!
//! Previously the primitive was duplicated here and in `kovanica-keys`. The two
//! copies happened to agree, but drift between them would silently move every
//! derived address. There is now exactly one source.
//!
//! # Why the path is frozen
//!
//! The path, the coin type, and the hardened-index convention are **not**
//! negotiable without a coordinated breaking change across every client:
//! altering any of them changes every derived address and therefore every
//! on-chain balance. See `docs/DERIVATION.md` in the project vault.
//!
//! # Layering
//!
//! **Client-side only.** Nothing in this module participates in consensus, and
//! a node never needs it: consensus addresses come from a 32-byte seed handed
//! to [`kovanica_state::KeyPair::from_seed`]. The module exists so that the
//! mnemonic → seed → address rule is shared library code rather than a detail
//! duplicated across binaries.

pub use kovanica_keys::slip10::{derive_ed25519, derive_path};
pub use kovanica_keys::{DERIVATION_ACCOUNT, DERIVATION_PATH, SLIP44_COIN_TYPE};
