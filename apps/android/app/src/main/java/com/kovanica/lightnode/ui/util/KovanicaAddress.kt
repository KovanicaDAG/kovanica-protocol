package com.kovanica.lightnode.ui.util

import uniffi.kovanica.DerivedAccount

/**
 * The two renderings of a Kovanica P2PK address.
 *
 * ```
 * address bytes = 0x00 || ed25519_public_key   (33 bytes)
 * kvnc          = "kvnc" + base58(address bytes) + "dag"
 * hex           = lowercase hex of the 33 versioned bytes
 * ```
 *
 * Both the `kvnc` string and the public key come from the Rust core (the FFI
 * [`DerivedAccount`] record). The only work left here is prefixing the version
 * byte, which is an encoding rule rather than cryptography — the base58 encoder
 * this file used to carry is gone, because the core already renders the
 * address.
 */
object KovanicaAddress {

    data class Address(
        val kvnc: String,
        val hex: String,
    )

    /** Wrap the core's [`DerivedAccount`] in the app's address type. */
    fun fromAccount(account: DerivedAccount): Address =
        Address(kvnc = account.address, hex = VERSIONED_PREFIX + account.publicKeyHex)

    /** Version byte: P2PK addresses are `0x00 || pubkey`. */
    private const val VERSIONED_PREFIX = "00"
}
