import Foundation

// Linux harness for the iOS wallet-key code. Run via `verify-vectors.sh`.
//
// It mirrors `apps/ios/KovanicaWalletTests/KovanicaKeysTests.swift` (which
// needs macOS + XCTest) so the same known answers can be checked on a Linux
// box, and additionally consumes `protocol/testvectors/vectors.json`. The
// sources under test are the unmodified `KovanicaKeys.swift` and the
// crate-owned generated UniFFI binding.

var failures = 0
var checks = 0

func check(_ condition: Bool, _ what: String) {
    checks += 1
    if !condition {
        failures += 1
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
    }
}

func checkEqual<T: Equatable>(_ got: T, _ want: T, _ what: String) {
    check(got == want, "\(what): got \(got), want \(want)")
}

let zeroPhrase = (Array(repeating: "abandon", count: 11) + ["about"])
    .joined(separator: " ")

let pinned: [(address: String, index: UInt32)] = [
    ("kvnc1A2ob7wBpGDrzuyLudnqwMyiqgwKhdN8RtcVGbTChbtvZdag", 0),
    ("kvnc1ESTrrsKKbWrxqKTZWrEHjqitk3GAnm8b8T7cV24e8h2cdag", 1),
    ("kvnc1EiucLwdZyLNuViDKjj5t4W96KKbAJv7EdXNTmER9V86udag", 2),
]

// MARK: - Frozen constants

checkEqual(KovanicaKeys.coinType, 3007, "coinType")
checkEqual(KovanicaKeys.derivationPath(index: 0), "m/44'/3007'/0'/0'/0'", "path 0")
checkEqual(KovanicaKeys.derivationPath(index: 2), "m/44'/3007'/0'/0'/2'", "path 2")

// MARK: - Known answers

for (expected, index) in pinned {
    do {
        let account = try KovanicaKeys.account(fromMnemonic: zeroPhrase, index: index)
        checkEqual(account.address, expected, "pinned address index \(index)")
        checkEqual(account.derivationPath, "m/44'/3007'/0'/0'/\(index)'", "derived path \(index)")
        checkEqual(
            try KovanicaKeys.address(fromMnemonic: zeroPhrase, index: index),
            expected,
            "address helper index \(index)"
        )
        let secret = try KovanicaKeys.signingSecret(fromMnemonic: zeroPhrase, index: index)
        checkEqual(secret.count, 64, "secret hex length index \(index)")
        checkEqual(
            try KovanicaKeys.address(fromSigningSecret: secret),
            expected,
            "secret round-trip index \(index)"
        )
    } catch {
        check(false, "derivation index \(index) threw \(error)")
    }
}

// MARK: - Behaviour that used to be wrong

do {
    let address = try KovanicaKeys.address(fromMnemonic: zeroPhrase)
    check(address.hasPrefix("kvnc1"), "address prefix")
    check(address.hasSuffix("dag"), "address suffix")

    let plain = try KovanicaKeys.address(fromMnemonic: zeroPhrase)
    let locked = try KovanicaKeys.address(fromMnemonic: zeroPhrase, passphrase: "hunter2")
    check(plain != locked, "passphrase changes the account")
    checkEqual(
        try KovanicaKeys.address(fromMnemonic: zeroPhrase, passphrase: "hunter2"),
        locked,
        "passphrase is deterministic"
    )

    let all = try pinned.map { try KovanicaKeys.address(fromMnemonic: zeroPhrase, index: $0.index) }
    checkEqual(Set(all).count, all.count, "indices give distinct addresses")
} catch {
    check(false, "behaviour checks threw \(error)")
}

// MARK: - Rejection

for bad in ["", "not a real phrase", "abandon abandon"] {
    check(!KovanicaKeys.isValidPhrase(bad), "rejects phrase \(bad.debugDescription)")
    do {
        _ = try KovanicaKeys.address(fromMnemonic: bad)
        check(false, "bad phrase did not throw: \(bad.debugDescription)")
    } catch {}
}

for bad in ["", "aabb", "nothex", String(repeating: "0", count: 66)] {
    do {
        _ = try KovanicaKeys.address(fromSigningSecret: bad)
        check(false, "bad key did not throw: \(bad.debugDescription)")
    } catch {}
}

// MARK: - Whitespace normalisation

do {
    let messy = "  abandon   abandon\nabandon\tabandon abandon abandon "
        + "abandon abandon abandon abandon abandon about  "
    check(KovanicaKeys.isValidPhrase(messy), "messy phrase valid")
    checkEqual(
        try KovanicaKeys.address(fromMnemonic: messy),
        try KovanicaKeys.address(fromMnemonic: zeroPhrase),
        "messy phrase normalised"
    )
} catch {
    check(false, "normalisation threw \(error)")
}

// MARK: - Canonical golden vectors (protocol/testvectors/vectors.json)

let vectorsPath = ProcessInfo.processInfo.environment["VECTORS_JSON"]
    ?? "protocol/testvectors/vectors.json"

do {
    let data = try Data(contentsOf: URL(fileURLWithPath: vectorsPath))
    guard let doc = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let vectors = doc["vectors"] as? [[String: Any]] else {
        check(false, "vectors.json shape")
        exit(failures == 0 ? 0 : 1)
    }
    var derived = 0
    for v in vectors where v["kind"] as? String == "derivation" {
        guard let name = v["name"] as? String,
              let phrase = v["mnemonic"] as? String,
              let index = v["index"] as? Int else {
            check(false, "vector missing fields")
            continue
        }
        let passphrase = v["passphrase"] as? String ?? ""
        do {
            let account = try KovanicaKeys.account(
                fromMnemonic: phrase,
                passphrase: passphrase,
                index: UInt32(index)
            )
            checkEqual(account.address, v["address"] as? String, "vector \(name)")
            derived += 1
        } catch {
            check(false, "vector \(name) threw \(error)")
        }
    }
    check(derived > 0, "expected derivation vectors")
    print("consumed \(derived) derivation vectors from \(vectorsPath)")
} catch {
    check(false, "could not read vectors.json at \(vectorsPath): \(error)")
}

print("iOS Swift harness: \(checks - failures)/\(checks) checks passed")
if failures == 0 {
    print("ALL GREEN")
} else {
    print("\(failures) FAILED")
    exit(1)
}
