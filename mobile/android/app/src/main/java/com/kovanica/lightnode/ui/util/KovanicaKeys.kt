package com.kovanica.lightnode.ui.util

import org.bouncycastle.crypto.digests.SHA512Digest
import org.bouncycastle.crypto.macs.HMac
import org.bouncycastle.crypto.params.KeyParameter

/**
 * Frozen Kovanica key derivation: 64-byte master material -> SLIP-0010
 * ed25519 -> public key -> `kvnc…dag` P2PK address.
 *
 * Port of the Rust authority in `sdk/crates/kovanica-keys` (module `slip10`).
 * Must agree byte for byte. Spec: `docs/backlog/DERIVATION.md`. Known-answer
 * vectors: `KovanicaKeysTest` and
 * `protocol/crates/kovanica-wallet/tests/slip10_vectors.rs`.
 *
 * ## Why this class exists
 *
 * Derivation was duplicated across binaries and the copies disagreed: some
 * truncated the master material to its first 32 bytes and used that as the
 * signing key, skipping SLIP-0010. The same recovery phrase then resolved to a
 * different address depending on which binary read it. On a UTXO chain that
 * means funds appear to vanish.
 *
 * ## The rule that is easy to get wrong
 *
 * The master material is 64 bytes. Do not truncate it to 32 and hand that to
 * [KovanicaAddress.fromSeed] — that bypasses SLIP-0010. Feed all 64 bytes to
 * [deriveSigningKey] and derive the address from *its* output.
 *
 * [deriveSigningKey] returns key material: nothing here logs or caches it,
 * and only the explicitly-named `…Hex` helpers stringify it.
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

    /** Length of the master material, in bytes. */
    const val BIP39_SEED_LEN: Int = 64

    /** Length of a derived Ed25519 signing key, in bytes. */
    const val SIGNING_KEY_LEN: Int = 32

    private const val HARDENED_BIT = 0x8000_0000.toInt()

    /** Highest non-hardened index, so `index or HARDENED_BIT` cannot overflow. */
    private const val HARDENED_MAX_INDEX = 0x7fff_ffff

    private const val HEX = "0123456789abcdef"

    /** The four constant steps of the frozen path; the fifth is the index. */
    private val DERIVATION_STEPS_PREFIX = intArrayOf(44, SLIP44_COIN_TYPE, DERIVATION_ACCOUNT, 0)

    /** SLIP-0010 master-node HMAC key (RFC 8032). */
    private val MASTER_KEY = "ed25519 seed".toByteArray(Charsets.US_ASCII)

    /** HMAC-SHA512, as required by SLIP-0010. */
    private fun hmacSha512(key: ByteArray, data: ByteArray): ByteArray {
        val mac = HMac(SHA512Digest())
        mac.init(KeyParameter(key))
        mac.update(data, 0, data.size)
        val out = ByteArray(mac.macSize)
        mac.doFinal(out, 0)
        return out
    }

    /**
     * Master node: `I = HMAC-SHA512(key = MASTER_KEY, data = seed)`.
     * Returns `(key, chainCode)`, 32 bytes each.
     */
    private fun master(seed: ByteArray): Pair<ByteArray, ByteArray> {
        require(seed.size == BIP39_SEED_LEN) {
            "master material must be $BIP39_SEED_LEN bytes, got ${seed.size}"
        }
        val i = hmacSha512(MASTER_KEY, seed)
        return i.copyOfRange(0, 32) to i.copyOfRange(32, 64)
    }

    /**
     * Hardened child — the only derivation ed25519 supports in SLIP-0010.
     *
     * `I = HMAC-SHA512(key = chainCode, data = 0x00 ‖ ser256(key) ‖ ser32(i))`
     * with the hardened bit forced on in the index.
     */
    private fun ckdHardened(
        key: ByteArray,
        chainCode: ByteArray,
        index: Int,
    ): Pair<ByteArray, ByteArray> {
        require(index in 0..HARDENED_MAX_INDEX) {
            "address index must be in 0..$HARDENED_MAX_INDEX, got $index"
        }
        val data = ByteArray(1 + 32 + 4)
        data[0] = 0x00
        key.copyInto(data, 1)
        val hardened = index or HARDENED_BIT
        data[33] = (hardened ushr 24).toByte()
        data[34] = (hardened ushr 16).toByte()
        data[35] = (hardened ushr 8).toByte()
        data[36] = hardened.toByte()

        val i = hmacSha512(chainCode, data)
        return i.copyOfRange(0, 32) to i.copyOfRange(32, 64)
    }

    /**
     * Derive the 32-byte Ed25519 signing key at `m/44'/3007'/0'/0'/index'`
     * from 64 bytes of master material. All five steps are hardened.
     */
    fun deriveSigningKey(
        bip39Seed: ByteArray,
        index: Int = DEFAULT_ADDRESS_INDEX,
    ): ByteArray {
        var (key, chainCode) = master(bip39Seed)
        for (step in DERIVATION_STEPS_PREFIX + index) {
            val (childKey, childChain) = ckdHardened(key, chainCode, step)
            key = childKey
            chainCode = childChain
        }
        return key
    }

    /**
     * The address for a recovery phrase, at [index]. Performs the whole chain.
     * The phrase and passphrase are not retained.
     */
    fun addressFromMnemonic(
        phrase: String,
        passphrase: String = "",
        index: Int = DEFAULT_ADDRESS_INDEX,
        bip39: Bip39,
    ): KovanicaAddress.Address =
        addressFromSeed(bip39.mnemonicToSeed(phrase, passphrase), index)

    /** The address for 64 bytes of master material, at [index]. */
    fun addressFromSeed(
        bip39Seed: ByteArray,
        index: Int = DEFAULT_ADDRESS_INDEX,
    ): KovanicaAddress.Address =
        KovanicaAddress.fromSeed(deriveSigningKey(bip39Seed, index))

    /**
     * The signing key for a recovery phrase, as lowercase hex. Only for
     * callers that must hand key material to a signer.
     */
    fun signingKeyHex(
        phrase: String,
        passphrase: String = "",
        index: Int = DEFAULT_ADDRESS_INDEX,
        bip39: Bip39,
    ): String =
        deriveSigningKey(bip39.mnemonicToSeed(phrase, passphrase), index).toHex()

    private fun ByteArray.toHex(): String {
        val out = CharArray(size * 2)
        for (i in indices) {
            val v = this[i].toInt() and 0xff
            out[i * 2] = HEX[v ushr 4]
            out[i * 2 + 1] = HEX[v and 0x0f]
        }
        return String(out)
    }
}
