package com.kovanica.lightnode.ui.util

import uniffi.kovanica.DerivedAccount
import uniffi.kovanica.accountFromSigningSecret
import uniffi.kovanica.deriveAccountFromMnemonic
import uniffi.kovanica.mnemonicIsValid
import uniffi.kovanica.slip10DerivationPath
import uniffi.kovanica.slip44CoinType

/**
 * Frozen Kovanica key derivation — a thin wrapper over the UniFFI surface.
 *
 * There is **no cryptography in this file**, and after this change none
 * anywhere else in the app. Key stretching, SLIP-0010 ed25519 derivation at
 * `m/44'/3007'/0'/0'/i'`, and the `0x00 || pubkey` address encoding all live in
 * the Rust core (`kovanica-wallet`, surfaced by `kovanica-ffi`), which is the
 * one implementation the CLI, the node, and every other client use. The known
 * answers are pinned by `protocol/testvectors/vectors.json`.
 *
 * ## The rule that is easy to get wrong
 *
 * The 64-byte BIP-39 master material is not a signing key. Truncating it to 32
 * bytes and handing that to a signer — which this app used to do — derives a
 * keypair nobody controls, so the same recovery phrase resolves to a
 * balance-less address. Always go through the FFI, which returns the SLIP-0010
 * *child*.
 *
 * The derived secret is key material: nothing here logs or caches it, and only
 * the explicitly named `…Hex` helpers stringify it.
 */
object KovanicaKeys {

    /** SLIP-44 style coin type for Kovanica. */
    const val SLIP44_COIN_TYPE: Int = 3007

    /** Account depth used by the frozen path. */
    const val DERIVATION_ACCOUNT: Int = 0

    /** Address index used when a caller does not pick one. */
    const val DEFAULT_ADDRESS_INDEX: Int = 0

    /** The frozen hardened-only derivation path, for display and logs. */
    const val DERIVATION_PATH: String = "m/44'/3007'/0'/0'/i'"

    /**
     * Highest address index accepted by the wrapper. The FFI takes a `u32`;
     * capping below `0x8000_0000` keeps the wrapper's contract identical to the
     * one this class had when it derived in-process, and keeps a caller from
     * passing a negative `Int` that would silently wrap.
     */
    private const val MAX_ADDRESS_INDEX = 0x7fff_ffff

    private fun checkIndex(index: Int): UInt {
        require(index in 0..MAX_ADDRESS_INDEX) {
            "address index must be in 0..$MAX_ADDRESS_INDEX, got $index"
        }
        return index.toUInt()
    }

    /** The full derived account at [index]: address, public key, signing key. */
    fun accountFromMnemonic(
        phrase: String,
        passphrase: String = "",
        index: Int = DEFAULT_ADDRESS_INDEX,
    ): DerivedAccount = deriveAccountFromMnemonic(phrase, passphrase, checkIndex(index))

    /**
     * The address for a recovery phrase, at [index]. Performs the whole chain
     * in Rust. The phrase and passphrase are not retained.
     */
    fun addressFromMnemonic(
        phrase: String,
        passphrase: String = "",
        index: Int = DEFAULT_ADDRESS_INDEX,
    ): KovanicaAddress.Address = KovanicaAddress.fromAccount(accountFromMnemonic(phrase, passphrase, index))

    /**
     * The signing key for a recovery phrase, as lowercase hex. Only for
     * callers that must hand key material to a signer.
     */
    fun signingKeyHex(
        phrase: String,
        passphrase: String = "",
        index: Int = DEFAULT_ADDRESS_INDEX,
    ): String = accountFromMnemonic(phrase, passphrase, index).signingSecretHex

    /** The address owning a raw 32-byte Ed25519 signing key (lowercase hex). */
    fun addressFromSigningKeyHex(signingSecretHex: String): KovanicaAddress.Address =
        KovanicaAddress.fromAccount(accountFromSigningSecret(signingSecretHex))

    /** Whether [phrase] is a well-formed recovery phrase (word list, count, checksum). */
    fun isValidPhrase(phrase: String): Boolean = mnemonicIsValid(phrase)

    /** The frozen path for [index], e.g. `m/44'/3007'/0'/0'/0'`. */
    fun derivationPath(index: Int = DEFAULT_ADDRESS_INDEX): String = slip10DerivationPath(checkIndex(index))

    /** The frozen SLIP-44 coin type, straight from the core. */
    fun coinType(): Int = slip44CoinType().toInt()
}
