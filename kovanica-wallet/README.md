# Kovanica Wallet

A standalone **Kovanica Wallet** app for **Android** and **iOS**. It is a
**pure API-backed wallet** — it reads a remote Kovanica node over HTTP with
**no light node, no SPV sync, and no FFI / native bindings**.

> Only the canonical `shared/kvnc-logo.png` is used as the token/launcher icon.
> No other image assets.

## Platforms

| Platform | Stack | Path | Build |
|---|---|---|---|
| Android | Kotlin + Jetpack Compose (Material3) | `android/` | `./gradlew -p android :app:assembleDebug` (wired into `.github/workflows/wallet.yml`) |
| iOS | Swift + SwiftUI | `ios/` | `xcodebuild -project KovanicaWallet.xcodeproj -scheme KovanicaWallet` (needs a Mac/Xcode; not buildable on Linux) |

## What it does (v1)

- Show the KVNC logo, wallet address (`kvnc…`), formatted balance, and a
  KVNC · network badge.
- **Receive**: display the full `kvnc…` watch address with a Copy button.
- **History**: paginated transactions from `/api/history`.
- **Faucet**: request 1 testnet KVNC via `POST /api/faucet`.
- Poll `/api/head` for the current chain tip / last block.

The user enters a `kvnc…` address to watch (a receive/monitoring wallet in v1).

## What it deliberately does NOT do (v1)

- **Send / sign** transactions. Building and signing a transfer requires an
  ed25519 + sighash crypto binding (or the light-node FFI). This is a planned
  follow-up, not faked here — the Send button is disabled/omitted.
- Run a light node / SPV sync — this app never downloads or verifies the chain
  locally; it trusts the configured node's REST API.

## Node API contract (verified against the live testnet explorer)

Default node: `https://explorer.kovanica.online` (user-settable). Token facts:
`KVNC`, **8 decimals**, `1 KVNC = 100,000,000 atoms`.

- `GET /api/head` → `{network, genesis, tip, blocks, min_fee, atom}`
- `GET /api/bootstrap` → `{network, ..., token:"KVNC", k, subsidy, founder_amount, ...}`
- `GET /api/fee_estimate` → `{fee_rate, unit, mempool, bytes}`
- `GET /api/state` → node state (mining, faucet, operator, network, peers, mesh)
- `GET /api/address/<addr>` → `{address, balance, tx_count}`
- `GET /api/utxos?address=&limit=` → UTXO list
- `GET /api/history?address=&limit=&offset=` → paginated history entries
- `GET /api/blocks?from=` → block list
- `POST /api/faucet` → body `{"address":"kvnc…"}` → tx receipt
