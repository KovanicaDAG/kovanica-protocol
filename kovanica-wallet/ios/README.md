# Kovanica Wallet (iOS)

API-backed wallet for the Kovanica testnet. Connects to a remote Kovanica node over HTTP — no light-node, no SPV sync, no FFI/UniFFI bindings.

## Architecture

- **Pure URLSession networking** — REST API calls to any Kovanica node
- **SwiftUI + Combine** — dark-themed native iOS UI
- **Swift concurrency** — async/await, `@MainActor` view model
- **No native libs** — zero C/Rust dependencies

## Features (v1)

- View wallet balance (atoms and KVNC formatted to 8 decimals)
- Receive address display + copy to clipboard
- Faucet: request 1 testnet KVNC
- Transaction history with pagination
- Configurable node URL

## Send / Sign

Signing requires ed25519 key generation and sighash computation — this is a follow-up. The Send button is disabled and marked "Coming Soon."

## Build

1. Open `KovanicaWallet.xcodeproj` in Xcode 15+
2. Select an iOS 16+ simulator or device target
3. Build and run (`Cmd+R`)

No CocoaPods, SPM, or Carthage — zero external dependencies.

## Install on a real iPhone — no Mac needed

iOS apps can only be *built* on macOS, but you do **not** need a Mac to *get the
app onto your phone*: our CI builds the app for a physical device on GitHub's
macOS runners and exports an **unsigned `.ipa`**. A sideload tool on any PC
(Windows/Linux) re-signs it with your **free Apple ID** at install time.

**Prereqs:** an iPhone on iOS 16+, a PC (Windows/Linux), and a free Apple ID.

1. **Get the `.ipa`.** In GitHub Actions, run the **"kovanica wallet"** workflow
   (on `main`), then open the **"Export iOS wallet .ipa (unsigned, sideloadable)"**
   job and download the `kovanica-wallet-ios-ipa` artifact (a
   `KovanicaWallet-ios-unsigned.ipa`, ~3.6 MB). The job is defined in
   `.github/workflows/wallet.yml`.
2. **Install a sideload tool on your PC** — **AltStore** (altstore.io) or
   **Sideloadly** (sideloadly.io).
3. **Sign in** with your Apple ID, connect the iPhone via USB, and **trust** the
   device when prompted.
4. **Drag the `.ipa`** onto the tool. It installs and re-signs with your Apple ID.
5. **On the phone:** **Settings → General → VPN & Device Management** → tap your
   Apple ID profile → **Trust**, then open the Kovanica Wallet.

**Limits of the free-Apple-ID route:** sideloads **expire after 7 days**
(re-trust / reinstall weekly) and a free account covers only ~3 devices. A paid
Apple Developer account removes the expiry and device-cap limits.

## Project Structure

```
KovanicaWallet.xcodeproj/
KovanicaWallet/
  KovanicaWalletApp.swift        # @main entry point
  ContentView.swift               # Navigation root, address entry
  Models/WalletModels.swift       # Codable models, formatting
  Networking/KovAPIClient.swift   # URLSession HTTP client
  Networking/WalletRepository.swift
  ViewModels/WalletViewModel.swift
  Views/HomeView.swift            # Balance, actions, faucet
  Views/ReceiveView.swift         # Address display + copy
  Views/HistoryView.swift         # Paginated tx list
  Views/Theme.swift               # KVNCBrand color palette
  Info.plist
  Assets.xcassets/                # App icon (kvnc-logo.png), accent color
```

## API

Default node: `https://explorer.kovanica.online` (settable in-app).

Endpoints used: `/api/head`, `/api/bootstrap`, `/api/state`, `/api/address/<addr>`, `/api/history`, `/api/fee_estimate`, `POST /api/faucet`.

## Branding

- Background: `#09090B`
- Foreground: `#D8D4CC`
- Accent gold: `#C9A227`
- App icon: `kvnc-logo.png` (1024x1024, universal iOS)
