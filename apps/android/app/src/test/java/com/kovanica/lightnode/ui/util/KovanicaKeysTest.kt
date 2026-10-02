package com.kovanica.lightnode.ui.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Properties

/**
 * Known-answer tests for the frozen Kovanica derivation.
 *
 * The expected values live in `derivation-vectors.properties` as data, and
 * the authoritative copies live in the Rust suite
 * `protocol/crates/kovanica-wallet/tests/slip10_vectors.rs`. Neither is the
 * origin of truth in isolation: if the two ever disagree, SLIP-0010 or the
 * frozen path changed and every client would resolve a different address.
 */
class KovanicaKeysTest {

    /** Zero-entropy phrase, the input the vectors in `material` were made from. */
    private val phrase =
        "abandon abandon abandon abandon abandon abandon " +
            "abandon abandon abandon abandon abandon about"

    private val vectors: Properties =
        Properties().apply {
            val loader = checkNotNull(KovanicaKeysTest::class.java.classLoader)
            val stream = checkNotNull(loader.getResourceAsStream("derivation-vectors.properties"))
            stream.use { load(it) }
                ?: error("derivation-vectors.properties missing from test resources")
        }

    private val material: ByteArray get() = vectors.str("material").unhex()

    private fun expect(index: Int, field: String): String = vectors.str("index.$index.$field")

    // --- frozen constants -------------------------------------------------

    @Test
    fun `frozen path constants match the spec`() {
        assertEquals(3007, KovanicaKeys.SLIP44_COIN_TYPE)
        assertEquals(0, KovanicaKeys.DERIVATION_ACCOUNT)
        assertEquals(0, KovanicaKeys.DEFAULT_ADDRESS_INDEX)
        assertEquals("m/44'/3007'/0'/0'/i'", KovanicaKeys.DERIVATION_PATH)
    }

    // --- derivation -------------------------------------------------------

    @Test
    fun `derives the pinned signing key at each index`() {
        for (index in 0..2) {
            assertEquals(
                "index $index",
                expect(index, "key"),
                KovanicaKeys.deriveSigningKey(material, index).hex(),
            )
        }
    }

    @Test
    fun `derives the pinned address end to end`() {
        for (index in 0..2) {
            val address = KovanicaKeys.addressFromSeed(material, index)
            assertEquals("index $index hex", expect(index, "hex"), address.hex)
            assertEquals("index $index kvnc", expect(index, "kvnc"), address.kvnc)
        }
    }

    @Test
    fun `distinct indices yield distinct addresses`() {
        val seen = (0..2).map { KovanicaKeys.addressFromSeed(material, it).kvnc }
        assertEquals("every index must be distinct", seen.size, seen.toSet().size)
    }

    // --- the regression this class exists to prevent ----------------------

    @Test
    fun `slip10 output differs from the truncated material`() {
        // Truncating to 32 bytes and using that as the signing key is the
        // historical bug. It produced a different, unspendable address for
        // the same recovery phrase.
        val wrong = KovanicaAddress.fromSeed(material.copyOf(32)).kvnc
        val right = KovanicaKeys.addressFromSeed(material, 0).kvnc
        assertNotEquals(wrong, right)
    }

    @Test
    fun `rejects material that is not 64 bytes`() {
        // Guards against a caller silently re-introducing the truncation.
        assertThrows(IllegalArgumentException::class.java) {
            KovanicaKeys.deriveSigningKey(material.copyOf(32), 0)
        }
    }

    @Test
    fun `rejects an out of range address index`() {
        assertThrows(IllegalArgumentException::class.java) {
            KovanicaKeys.deriveSigningKey(material, -1)
        }
        // Int.MIN_VALUE: negative and also the one value that would make
        // `index or HARDENED_BIT` collide with a legitimate index.
        assertThrows(IllegalArgumentException::class.java) {
            KovanicaKeys.deriveSigningKey(material, Int.MIN_VALUE)
        }
    }

    @Test
    fun `the pinned material is what the standard stretch produces`() {
        // Closes the last gap: every other test starts from `material`, so
        // this is what proves the phrase those tests came from.
        assertEquals(vectors.str("material"), Bip39.seedFromMnemonic(phrase).hex())
    }

    @Test
    fun `a recovery phrase resolves to the pinned address`() {
        // The chain the wallets actually run, with no Context and no shortcuts.
        for (index in 0..2) {
            assertEquals(
                "index $index",
                expect(index, "kvnc"),
                KovanicaKeys.addressFromSeed(Bip39.seedFromMnemonic(phrase), index).kvnc,
            )
        }
    }

    // --- helpers ----------------------------------------------------------

    private fun Properties.str(key: String): String =
        getProperty(key)?.trim() ?: error("missing vector $key")

    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }

    private fun String.unhex(): ByteArray {
        require(length % 2 == 0) { "hex string must have even length" }
        return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }
}
