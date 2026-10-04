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
//! authority operator. See `protocol/authority-keys/authorities.conf` (tracked)
//! for the live set, and `protocol/authority-keys/*.env` (gitignored) for the
//! operator-side material.
//!
//! ## Changing this list
//!
//! **Never** edit this to "fix" a parity failure. The set is the network's
//! identity: a different set means a different genesis and a different chain.
//! It changes only via the on-chain governance path (a threshold-signed
//! `AuthorityUpdateTx` spending the current `KVA1` authority UTXO), or by a
//! deliberate network reset. Re-pin against `GET /api/head` on that event.
//!
//! Re-pinned 2026-10-04 against `GET /api/head` after the testnet reset: the
//! live genesis now matches the one the dashboard already pins in
//! `apps/dashboard/backend/server.py`, and the keys below match
//! `protocol/authority-keys/authorities.conf`. Confirmed by rebuilding the
//! genesis id with this set (matches the live value exactly) and with the
//! previous set (does not) — see `tests/genesis_parity.rs::LIVE_GENESIS`.

/// Live testnet authority set, in canonical (ascending) order — the order
/// `AuthoritySet` enforces, so listing order here is irrelevant to the hash.
pub const TESTNET_AUTHORITY_KEYS: [[u8; 32]; 3] = [
    // a1affed944312b0a8a1627b126d8162bba7a3abba7710bb349b621bac732266f
    [
        0xa1, 0xaf, 0xfe, 0xd9, 0x44, 0x31, 0x2b, 0x0a, 0x8a, 0x16, 0x27, 0xb1, 0x26, 0xd8, 0x16,
        0x2b, 0xba, 0x7a, 0x3a, 0xbb, 0xa7, 0x71, 0x0b, 0xb3, 0x49, 0xb6, 0x21, 0xba, 0xc7, 0x32,
        0x26, 0x6f,
    ],
    // a5e261ae6d582f31c37b727a3abda3f1b536822d62f7a7515721fcbeb7a1a662
    [
        0xa5, 0xe2, 0x61, 0xae, 0x6d, 0x58, 0x2f, 0x31, 0xc3, 0x7b, 0x72, 0x7a, 0x3a, 0xbd, 0xa3,
        0xf1, 0xb5, 0x36, 0x82, 0x2d, 0x62, 0xf7, 0xa7, 0x51, 0x57, 0x21, 0xfc, 0xbe, 0xb7, 0xa1,
        0xa6, 0x62,
    ],
    // d1a14d2c0d228b9d04a7f852404eefc6e1057698bf1b8105b6f0c6e443bce632
    [
        0xd1, 0xa1, 0x4d, 0x2c, 0x0d, 0x22, 0x8b, 0x9d, 0x04, 0xa7, 0xf8, 0x52, 0x40, 0x4e, 0xef,
        0xc6, 0xe1, 0x05, 0x76, 0x98, 0xbf, 0x1b, 0x81, 0x05, 0xb6, 0xf0, 0xc6, 0xe4, 0x43, 0xbc,
        0xe6, 0x32,
    ],
];

/// Authority update threshold of the live testnet set (2-of-3, a strict
/// majority — matching the node crate's default for an explicit set).
///
/// Governs `AuthorityUpdateTx` validity (RFC-POA §1). Not an admission
/// threshold: under PoA the *scheduled* authority for a slot is
/// `keys[slot % n]` and signs alone, with no per-block quorum.
pub const TESTNET_AUTHORITY_THRESHOLD: usize = 2;
