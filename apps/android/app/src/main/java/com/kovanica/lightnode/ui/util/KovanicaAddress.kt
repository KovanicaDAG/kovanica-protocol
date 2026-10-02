package com.kovanica.lightnode.ui.util

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters

/**
 * Derives a Kovanica P2PK address from a 32-byte Ed25519 seed.
 *
 * This mirrors the Rust side (`KeyPair::from_seed(seed).address()`):
 *   address bytes = 0x00 || ed25519_public_key
 *   human form    = "kvnc" + base58(address_bytes) + "dag"
 *   wire form     = lowercase hex of the 33 versioned bytes
 */
object KovanicaAddress {

    data class Address(
        val kvnc: String,
        val hex: String,
    )

    fun fromSeed(seed: ByteArray): Address {
        require(seed.size == 32) { "seed must be 32 bytes" }

        val privateKey = Ed25519PrivateKeyParameters(seed, 0)
        val publicKey = privateKey.generatePublicKey().encoded // 32 bytes

        val addressBytes = ByteArray(33).apply {
            this[0] = 0x00.toByte()
            System.arraycopy(publicKey, 0, this, 1, publicKey.size)
        }

        val hex = addressBytes.joinToString("") { "%02x".format(it) }
        val kvnc = "kvnc${Base58.encode(addressBytes)}dag"
        return Address(kvnc, hex)
    }
}
