//! The live testnet PoA authority set (RFC-POA §1, KVP-201) as **public**
//! Ed25519 verifying keys.
//!
//! ## Why this is a literal key list
//!
//! The node crate's testnet *fallback* derives a deterministic placeholder set
//! from a base value (`explorer.rs::AUTHORITY_PLACEHOLDER_BASE`), so a single
//! node can produce in every slot. **The live testnet does not use that
//! fallback** — it is configured with an explicit `KOVANICA_AUTHORITIES` list
//! produced by an authority-key ceremony. The three keys below are what
//! `GET /api/head` reports as `authority_set`.
//!
//! That distinction is consensus-critical, not cosmetic: the genesis coinbase
//! tag is `KVA1 || authority_set_hash`
//! ([`kovanica_state::poa_genesis_tag`]), so the genesis id commits to this
//! set. Deriving the placeholder set instead produces a *different, valid*
//! genesis — a hard fork — which is exactly what the genesis-parity gate
//! catches.
//!
//! ## Confidentiality
//!
//! These are **public** keys: the same values are served unauthenticated on
//! `/api/head` for any caller. Nothing confidential belongs in this file. The
//! corresponding signing keys are operator credentials and are never held by
//! an embedded client node — per RFC-POA §1, each authority sets its own
//! signing key via `set_authority_signing_key`, and a desktop wallet is not an
//! authority operator. See `protocol/authority-keys/` for the operator-side
//! material, which is gitignored.
//!
//! ## Changing this list
//!
//! **Never** edit this to "fix" a parity failure. The set is the network's
//! identity: a different set means a different genesis and a different chain.
//! It changes only via the on-chain governance path (a threshold-signed
//! `AuthorityUpdateTx` spending the current `KVA1` authority UTXO), or by a
//! deliberate network reset. Re-pin against `GET /api/head` on that event.

/// Live testnet authority set, in canonical (ascending) order — the order
/// `AuthoritySet` enforces, so listing order here is irrelevant to the hash.
pub const TESTNET_AUTHORITY_KEYS: [[u8; 32]; 3] = [
    // 4a4172c14e6073998caf9ad256974cd2908a67b7751fdbc2f031c24736b8e8ec
    [
        0x4a, 0x41, 0x72, 0xc1, 0x4e, 0x60, 0x73, 0x99, 0x8c, 0xaf, 0x9a, 0xd2, 0x56, 0x97, 0x4c,
        0xd2, 0x90, 0x8a, 0x67, 0xb7, 0x75, 0x1f, 0xdb, 0xc2, 0xf0, 0x31, 0xc2, 0x47, 0x36, 0xb8,
        0xe8, 0xec,
    ],
    // 8ebc8a73235b631845d32ed4ea2d1dc563acfa1215b18428b17364c6e1563cf3
    [
        0x8e, 0xbc, 0x8a, 0x73, 0x23, 0x5b, 0x63, 0x18, 0x45, 0xd3, 0x2e, 0xd4, 0xea, 0x2d, 0x1d,
        0xc5, 0x63, 0xac, 0xfa, 0x12, 0x15, 0xb1, 0x84, 0x28, 0xb1, 0x73, 0x64, 0xc6, 0xe1, 0x56,
        0x3c, 0xf3,
    ],
    // d6903aa7a17abfe681988f1b49a8adcec0d475c5e24ab955c1349a1c463bedae
    [
        0xd6, 0x90, 0x3a, 0xa7, 0xa1, 0x7a, 0xbf, 0xe6, 0x81, 0x98, 0x8f, 0x1b, 0x49, 0xa8, 0xad,
        0xce, 0xc0, 0xd4, 0x75, 0xc5, 0xe2, 0x4a, 0xb9, 0x55, 0xc1, 0x34, 0x9a, 0x1c, 0x46, 0x3b,
        0xed, 0xae,
    ],
];

/// Authority update threshold of the live testnet set (2-of-3, a strict
/// majority — matching the node crate's default for an explicit set).
///
/// Governs `AuthorityUpdateTx` validity (RFC-POA §1). Not an admission
/// threshold: under PoA the *scheduled* authority for a slot is
/// `keys[slot % n]` and signs alone, with no per-block quorum.
pub const TESTNET_AUTHORITY_THRESHOLD: usize = 2;
