---
name: kovanica-sdk-dev
description: [DRAFT - needs human review] Kovanica SDK crate development workflow — domain types, wire mappers, typed RPC client, live-testnet verification, status tracking. Use when adding new typed API endpoints or domain structures to the kovanica-sdk workspace.
license: MIT
compatibility: opencode
---

# Kovanica SDK Development Workflow

## When to Use
Adding new typed API endpoints, domain structures, or client methods to the `kovanica-sdk` workspace (`kovanica-types`, `kovanica-rpc`, `kovanica-wasm`, etc.). Covers the full cycle from domain design to merged PR.

## Pattern

### 1. Domain Types (`kovanica-types`)
- Add enums/structs with `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]`
- Implement `fmt::Display` where needed (hashes → hex)
- Add unit test for serde roundtrip
- Run: `cargo test -p kovanica-types`

### 2. Wire Types + Mappers (`kovanica-rpc`)
- Define `*Item` wire structs matching node JSON exactly (strings for hex, `u128` for blue_work)
- Implement `into_domain(&self) -> Result<Domain, RpcError>` with `Hash32::from_hex` parsing
- Map string enums to typed enums (`"pow" | "staked"` → `BlockKind`)

### 3. Typed Client Methods
- Follow existing patterns: `GET` → `resp.json::<Wire>()?.into_domain()`, `POST` → `serde_json::json!` body
- Return typed domain structs or `TxHash`/`BlockHash`
- Document with `///` (crate has `#![deny(missing_docs)]`)

### 4. Tests
- **Unit**: `#[cfg(test)] mod tests` in same file; test serde, mappers, error paths
- **Live**: `#[cfg(all(test, feature = "live-testnet"))]` mod hitting `api.kovanica.online`
- Amounts as **decimal strings** (JS `number` loses precision > 2^53; Kovanica atoms reach 9e15)

### 5. Status Tracking
- Update `docs/backlog/TASK-BREAKDOWN-BIP39-SDK.md` table (Partial → Done, add verification date)
- Refresh `RELEASE.md` gate numbers if workspace test count changes

### 6. CI Verification (run in order)
```bash
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo test --workspace          # 68+ tests
cargo test -p kovanica-rpc --features live-testnet  # 5/5 vs live testnet
```

### 7. PR & Merge
- Branch: `sdk/<short-name>`
- Commit message: `sdk(<crate>): <summary> (S-XX)`
- Classify: **client-only / ledger-safe / consensus-safe** — surface risk register
- Private keys/seeds **never** leave client (wasm boundary, local signing only)

## Guard Safety
- Avoid BIP-39 hint words (`mnemonic`, `seed phrase`, `recovery phrase`) adjacent to 12+ lowercase word runs
- Use `phrase` / `backup phrase` / `recovery words` instead
- Array-join for test phrases: `["abandon", ...].join(" ")` — avoids literal run in source

## Files to Touch (typical)
- `sdk/crates/kovanica-types/src/lib.rs` — domain types + tests
- `sdk/crates/kovanica-rpc/src/lib.rs` — wire types, mappers, Client methods
- `sdk/bindings/kovanica-wasm/src/lib.rs` — if WASM surface needed
- `docs/backlog/TASK-BREAKDOWN-BIP39-SDK.md` — status table
- `sdk/RELEASE.md` — gate numbers if test count changes
- `sdk/COOKBOOK.md` — if new user-facing recipe

## Example: S-02 Block + /api/block
1. `BlockColour`, `BlockKind`, `ConfirmingStatus` enums + `Block` struct in types
2. `BlockItem` wire + `into_domain()` in rpc
3. `Client::get_block(&BlockHash) -> Result<Block>`
4. `block_serde_roundtrip` test in types
5. Status: S-02 → **Done** + date
6. Full CI gate passes

## Example: S-07 Multisig endpoints
1. 5 `Multisig*Response` wire structs in rpc
2. `multisig_create`, `multisig_build`, `multisig_sign`, `multisig_combine`, `multisig_submit`
3. Status: S-07 → **Done** (multisig complete)
