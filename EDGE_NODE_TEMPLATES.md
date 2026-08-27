# Kovanica Edge: Light Node & Nano Wallet Templates

This document outlines the architecture for porting Kovanica to mobile devices and ultra-small embedded hardware.

## 1. Memory & Hardware Constraints
Because Kovanica is written in Rust, it can be compiled to `no_std` (bare metal without an OS).

| Node Type | Target Hardware | Estimated Memory (RAM) | Storage | Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Full Node** | Raspberry Pi 4 / 5 | ~200MB - 500MB | 10GB+ | Full DAG verification, complete UTXO set, mempool. |
| **Light Node** | iOS / Android (React Native/Expo) | ~10MB - 50MB | 50MB | Syncs headers, tracks personal UTXOs, signs transactions via Rust FFI. |
| **Nano Node** | ESP32, STM32, Pi Pico | ~100KB - 300KB | ~1MB Flash | Bare-metal `no_std` Rust. Ed25519 signing, BLAKE3 hashing, network broadcast via WiFi/Bluetooth. |

---

## 2. Mobile Phone Light Node App (Template)
**Tech Stack:** React Native (Expo) + Rust Core (via `uniffi` or `react-native-rust`)

### Architecture:
1. **Core Library:** Compile `kovanica-state` to an iOS framework (`.a` / `.xcframework`) and Android JNI (`.so`).
2. **Key Storage:** Use the mobile Secure Enclave (iOS Keychain / Android Keystore) to encrypt the Ed25519 seed.
3. **Sync Strategy (SPV):**
   - Connect to a trusted/random Full Node via WebSockets.
   - Request DAG headers to verify Proof of Work / Stake.
   - Use Bloom filters to request only UTXOs belonging to the phone's address.

### Example Integration (React Native):
```typescript
import { KovanicaCore } from 'react-native-kovanica-core';

async function sendTransaction(recipient, amount) {
  // 1. Fetch unspent outputs for our address from a Full Node
  const utxos = await fetchUTXOs(myAddress);
  
  // 2. Build and sign transaction locally (calls Rust FFI)
  const signedTx = await KovanicaCore.buildAndSign(
    utxos, recipient, amount, secureEnclaveKey
  );
  
  // 3. Broadcast to network
  await broadcastTx(signedTx);
}
```

---

## 3. ESP32 / IoT Nano Node (Template)
**Tech Stack:** Rust (`no_std`) + `esp-idf-hal`

An ESP32 cannot store the DAG. Instead, it acts as an ultra-secure hardware wallet or an automated IoT payment agent (e.g., a smart meter paying for electricity).

### Architecture:
1. **Dependencies:**
   - `ed25519-dalek` (compiled with `default-features = false` for `no_std`).
   - `blake3` (compiled with `no_std`).
2. **Network:** Use ESP32 WiFi to send raw bytes over a TCP socket to a Kovanica Full Node.
3. **Security:** Store the private key in the ESP32's encrypted flash or a connected secure element (e.g., ATECC608A).

### Example Rust Code (ESP32 bare-metal):
```rust
#![no_std]
use ed25519_dalek::{Keypair, Signer};
use kovanica_core::tx::{TxBuilder, Output}; // no_std compatible core

fn execute_iot_payment(keypair: &Keypair, node_ip: &str) {
    // 1. Build a micro-transaction
    let tx = TxBuilder::new()
        .add_output(Output::new(PAYMENT_ADDRESS, 500))
        .sign(keypair); // Signs with Ed25519

    // 2. Serialize to bytes
    let tx_bytes = tx.to_bytes();

    // 3. Broadcast via ESP32 WiFi socket
    esp_wifi_send(node_ip, &tx_bytes);
}
```

## 4. USB-Node / Hardware Wallet
A USB-Node (like a YubiKey or custom Raspberry Pi Zero) plugs into a computer and communicates via WebUSB or Serial.
- **Computer:** Runs the heavy Light Node or Full Node logic.
- **USB-Node:** Receives a BLAKE3 transaction hash via USB, prompts the user to press a physical button, and returns the 64-byte Ed25519 signature. The private key never leaves the USB stick.
