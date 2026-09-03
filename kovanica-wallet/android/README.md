# Kovanica Wallet (Android)

A standalone Android **Kovanica Wallet** — read + receive + faucet wallet that talks
to a remote Kovanica node over HTTP. Built with **Kotlin + Jetpack Compose (Material3)**.

This is a **pure API-backed wallet**. It does **NOT** run a light node, does **NOT** do
SPV sync, and uses **no FFI** (`LightNode`, `uniffi.kovanica`, or any native `.so` libs).
It only reads node state through the public REST API.

## What it does (v1)

- Shows the KVNC logo, wallet address, formatted balance, and network/token badge.
- Receive screen: shows the full `kvnc…` address with a **Copy** button, and explains
  that this is a receive-only watch wallet (no private key on device in v1).
- History screen: paginated list from `/api/history`, each row with a kind label,
  signed formatted amount, and a tx hex prefix.
- Faucet button: requests testnet KVNC via `POST /api/faucet`.
- Polls `/api/head` to show the current chain tip / last block on the home screen.

## What it does NOT do (v1)

**Sending / signing is intentionally NOT implemented.** Building and signing a
transaction requires a crypto binding (Ed25519 keys + Kovanica sighash). That is a
documented follow-up. Do not attempt to send from this v1 — there is a disabled
"Send (coming soon)" affordance by design (or none displayed), and the README notes
the signing follow-up.

## The /api contract (verified live)

Base URL is configurable. Default:
`KOVANICA_API_DEFAULT = "https://explorer.kovanica.online"`

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/head` | GET | `{network, genesis, tip, blocks, min_fee, atom}` |
| `/api/bootstrap` | GET | token params, k, subsidy, founder, depths, pow |
| `/api/fee_estimate` | GET | `{fee_rate, unit, mempool, bytes}` |
| `/api/state` | GET | node/network state |
| `/api/address/<addr>` | GET | `{address, balance (atoms), tx_count}` |
| `/api/utxos?address=&limit=` | GET | UTXO list |
| `/api/history?address=&limit=&offset=` | GET | paginated history entries |
| `/api/blocks?from=` | GET | block list |
| `/api/faucet` | POST | body `{"address":"kvnc…"}` |

Token facts (constants): symbol **KVNC**, name **Kovanica (KVNC)**, **8 decimals**,
`1 KVNC = 100,000,000 atoms`.

## Build

> Note: building requires the Android SDK on the machine. This repo's CI host may not
> have it installed, so the project is verified by self-review here.

```bash
cd android
chmod +x gradlew
./gradlew :app:assembleDebug
```

Install the resulting APK (e.g. with `./gradlew :app:installDebug` from a device/emulator).

## Signing follow-up

A future v1.1 will add send/sign backed by an Ed25519 crypto binding (BIP39 mnemonic
-> seed -> keypair -> Kovanica address + sighash). Watch address display is already
supported via `SeedStore` (plain SharedPreferences for v1).
