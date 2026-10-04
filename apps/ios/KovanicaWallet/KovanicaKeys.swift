import Foundation

/// Wallet key derivation, delegated to the Rust implementation.
///
/// # Why this is a thin wrapper and not a Swift implementation
///
/// Key derivation in Kovanica is **frozen**: a key stretch followed by the
/// fully-hardened SLIP-0010 ed25519 path `m/44'/3007'/0'/0'/i'`, pinned by a
/// known-answer suite in `kovanica-wallet`. The rule has exactly one
/// implementation, in Rust, and this app calls it through the light-node FFI
/// (`protocol/crates/kovanica-ffi/src/deriv.rs`).
///
/// The SwiftUI skeleton used to fake the address instead — it base64'd the
/// phrase and prefixed `kvnc1`. That is not a Kovanica address and it holds
/// nothing: a wallet that displayed it showed a permanent zero balance, and a
/// send from it would have targeted a keypair owning no UTXOs. Re-implementing
/// the derivation in Swift would have re-created a second rule that can drift
/// from the first, which is precisely the failure the frozen path exists to
/// prevent. So there is no Swift cryptography here at all.
///
/// # Layering
///
/// **Client-side only — no consensus or ledger impact.** Derivation touches no
/// GHOSTDAG, UTXO, emission, or validation rule. A node never derives an address
/// from a phrase; consensus addresses come from a 32-byte key.
///
/// # Key handling
///
/// `signingSecret` is a 32-byte key. It is held in memory for as long as the
/// app needs to sign and is **never** written to `UserDefaults`, plist, or log.
/// A production build should keep it in the Keychain; that is custody work and
/// is tracked separately.
enum KovanicaKeys {

    /// The address index this wallet uses (the `i` in the derivation path).
    static let addressIndex: UInt32 = 0

    /// A derived account: the public half (address, watch key) and the signing
    /// key, both straight from the Rust authority.
    struct Account {
        /// The receive address, rendered `kvnc…dag`.
        let address: String
        /// The raw 32-byte Ed25519 public key, lowercase hex.
        let publicKeyHex: String
        /// The raw 32-byte Ed25519 signing key, lowercase hex. Never log this.
        let signingSecretHex: String
        /// The frozen path this came from, e.g. `m/44'/3007'/0'/0'/0'`.
        let derivationPath: String
    }

    /// What can go wrong restoring a wallet.
    enum Failure: LocalizedError {
        /// The phrase is not a valid recovery phrase: wrong word, wrong count,
        /// or a broken checksum.
        case rejectedPhrase(String)
        /// A raw key was not 32 bytes of hex.
        case rejectedKey(String)

        var errorDescription: String? {
            switch self {
            case .rejectedPhrase(let detail):
                return "That recovery phrase is not valid. Check every word, the "
                    + "word count (12 or 24), and the order. (\(detail))"
            case .rejectedKey(let detail):
                return "This wallet key is malformed. (\(detail))"
            }
        }
    }

    /// Whether `phrase` is a well-formed recovery phrase. Purely local, so the
    /// user gets "that word is wrong" instead of a derived-and-wrong address.
    static func isValidPhrase(_ phrase: String) -> Bool {
        mnemonicIsValid(phrase: normalized(phrase))
    }

    /// Derive the account at `index` from a recovery phrase.
    ///
    /// `passphrase` is the optional "25th word" and may be empty. It is
    /// **honoured, not ignored**: the same phrase under a different passphrase
    /// is a different account, and dropping it would silently show an address
    /// that holds nothing rather than an error.
    static func account(
        fromMnemonic phrase: String,
        passphrase: String = "",
        index: UInt32 = addressIndex
    ) throws -> Account {
        let normalizedPhrase = normalized(phrase)
        guard isValidPhrase(normalizedPhrase) else {
            throw Failure.rejectedPhrase("word list, word count, or checksum")
        }
        do {
            let derived = try deriveAccountFromMnemonic(
                mnemonic: normalizedPhrase,
                passphrase: passphrase,
                addressIndex: index
            )
            return Account(
                address: derived.address,
                publicKeyHex: derived.publicKeyHex,
                signingSecretHex: derived.signingSecretHex,
                derivationPath: derived.derivationPath
            )
        } catch {
            throw Failure.rejectedPhrase(describe(error))
        }
    }

    /// The receive address for a recovery phrase.
    static func address(
        fromMnemonic phrase: String,
        passphrase: String = "",
        index: UInt32 = addressIndex
    ) throws -> String {
        try account(fromMnemonic: phrase, passphrase: passphrase, index: index).address
    }

    /// The 32-byte signing key (lowercase hex) for a recovery phrase — the
    /// `signingSecretHex` argument every light-node send method takes.
    static func signingSecret(
        fromMnemonic phrase: String,
        passphrase: String = "",
        index: UInt32 = addressIndex
    ) throws -> String {
        try account(fromMnemonic: phrase, passphrase: passphrase, index: index).signingSecretHex
    }

    /// The derivation path this wallet uses, for display on a settings screen.
    static func derivationPath(index: UInt32 = addressIndex) -> String {
        slip10DerivationPath(addressIndex: index)
    }

    /// The address owning a raw 32-byte key — the no-derivation (`m`) path used
    /// by genesis and by a raw-seed key file.
    ///
    /// It must agree with `account(fromMnemonic:)` for the matching key: a
    /// disagreement here would be the original bug in a new place, so the tests
    /// compose one into the other.
    static func address(fromSigningSecret secretHex: String) throws -> String {
        do {
            return try addressFromSigningSecret(signingSecretHex: secretHex)
        } catch {
            throw Failure.rejectedKey(describe(error))
        }
    }

    /// The frozen SLIP-44 coin type, so no screen has to hard-code it.
    static var coinType: UInt32 { slip44CoinType() }

    /// Users paste phrases with newlines and runs of spaces; the wire format
    /// wants single spaces and no leading or trailing whitespace.
    private static func normalized(_ phrase: String) -> String {
        phrase
            .split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" })
            .joined(separator: " ")
    }

    private static func describe(_ error: Error) -> String {
        if let derivation = error as? DerivationError {
            switch derivation {
            case .InvalidMnemonic(let msg): return msg
            case .BadSecretLength(let got): return "key was \(got) bytes, want 32"
            }
        }
        return (error as NSError).localizedDescription
    }
}
