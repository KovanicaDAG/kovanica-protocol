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
