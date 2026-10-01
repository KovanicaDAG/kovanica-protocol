import XCTest

@testable import KovanicaWallet

/// Known-answer tests for the Swift side of wallet derivation.
///
/// The same vectors are pinned in Rust — `protocol/crates/kovanica-wallet/tests/
/// slip10_vectors.rs` and `protocol/crates/kovanica-ffi/tests/ffi_deriv.rs`.
/// They are repeated here so a regression shows up as a failing **iOS** test
/// rather than as a wallet that quietly displays an address holding nothing.
///
/// The input is the canonical zero-entropy 128-bit phrase, assembled from words
/// so no phrase literal lives in source. These are public test vectors, not keys.
final class KovanicaKeysTests: XCTestCase {

    /// The zero-entropy 128-bit phrase: eleven copies of the first BIP-39
    /// English word plus the fourth.
    private static let zeroPhrase = (Array(repeating: "abandon", count: 11) + ["about"])
        .joined(separator: " ")

    /// Address vectors, indexed by the `i` in `m/44'/3007'/0'/0'/i'`.
    private static let pinned: [(address: String, index: UInt32)] = [
        ("kvnc1A2ob7wBpGDrzuyLudnqwMyiqgwKhdN8RtcVGbTChbtvZdag", 0),
        ("kvnc1ESTrrsKKbWrxqKTZWrEHjqitk3GAnm8b8T7cV24e8h2cdag", 1),
        ("kvnc1EiucLwdZyLNuViDKjj5t4W96KKbAJv7EdXNTmER9V86udag", 2),
    ]

    // MARK: - Frozen constants

    func testFrozenConstantsAreTheOnesTheLedgerUses() {
        XCTAssertEqual(KovanicaKeys.coinType, 3007)
        XCTAssertEqual(KovanicaKeys.derivationPath(index: 0), "m/44'/3007'/0'/0'/0'")
        XCTAssertEqual(KovanicaKeys.derivationPath(index: 2), "m/44'/3007'/0'/0'/2'")
    }

    // MARK: - Known answers

    func testEveryPinnedAddressDerives() throws {
        for (expected, index) in Self.pinned {
            let account = try KovanicaKeys.account(fromMnemonic: Self.zeroPhrase, index: index)
            XCTAssertEqual(account.address, expected, "index \(index)")
            XCTAssertEqual(account.derivationPath, "m/44'/3007'/0'/0'/\(index)'")
        }
    }

    func testTheThinHelpersAgree() throws {
        for (expected, index) in Self.pinned {
            XCTAssertEqual(
                try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase, index: index),
                expected
            )
        }
    }

    /// The signing key the light node takes must be the SLIP-0010 child, and
    /// must round-trip back to the same address through the raw-key path.
    func testSigningKeyComposesWithTheNodeSendSurface() throws {
        for (expected, index) in Self.pinned {
            let secret = try KovanicaKeys.signingSecret(fromMnemonic: Self.zeroPhrase, index: index)
            XCTAssertEqual(secret.count, 64, "32 bytes of hex at index \(index)")
            XCTAssertEqual(
                try KovanicaKeys.address(fromSigningSecret: secret),
                expected
            )
        }
    }

    // MARK: - Behaviour that used to be wrong

    /// The old implementation base64'd the phrase and prefixed `kvnc1`. That
    /// string is not an address and holds nothing, so a wallet displaying it
    /// showed a permanent zero balance.
    func testAddressIsNotAPlaceholderDerivedFromThePhrase() throws {
        let address = try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase)
        XCTAssertTrue(address.hasPrefix("kvnc1"))
        XCTAssertTrue(address.hasSuffix("dag"))
        let naive = "kvnc1" + Data(Self.zeroPhrase.utf8).base64EncodedString().prefix(38)
        XCTAssertNotEqual(address, naive)
    }

    /// A passphrase selects a different account. Ignoring it would show an
    /// address with no balance rather than an error.
    func testPassphraseIsHonouredNotIgnored() throws {
        let plain = try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase)
        let locked = try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase, passphrase: "hunter2")
        XCTAssertNotEqual(plain, locked)
        XCTAssertEqual(
            try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase, passphrase: "hunter2"),
            locked
        )
    }

    func testDistinctIndicesGiveDistinctAddresses() throws {
        let all = try Self.pinned.map { try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase, index: $0.index) }
        XCTAssertEqual(Set(all).count, all.count)
    }

    // MARK: - Rejection

    func testBadPhrasesThrowInsteadOfDeriving() {
        for bad in ["", "not a real phrase", "abandon abandon"] {
            XCTAssertFalse(KovanicaKeys.isValidPhrase(bad), bad)
            XCTAssertThrowsError(try KovanicaKeys.address(fromMnemonic: bad), bad)
        }
    }

    func testBadKeysThrow() {
        for bad in ["", "aabb", "nothex", String(repeating: "0", count: 66)] {
            XCTAssertThrowsError(try KovanicaKeys.address(fromSigningSecret: bad), bad)
        }
    }

    // MARK: - Input handling

    /// Users paste phrases with newlines and double spaces.
    func testPhraseWhitespaceIsNormalized() throws {
        let messy = "  abandon   abandon\nabandon\tabandon abandon abandon "
            + "abandon abandon abandon abandon abandon about  "
        XCTAssertTrue(KovanicaKeys.isValidPhrase(messy))
        XCTAssertEqual(
            try KovanicaKeys.address(fromMnemonic: messy),
            try KovanicaKeys.address(fromMnemonic: Self.zeroPhrase)
        )
    }
}
