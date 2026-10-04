package com.kovanica.lightnode.ui.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import uniffi.kovanica.DerivationException
import java.util.Properties

/**
 * Known-answer tests for the frozen Kovanica derivation.
 *
 * The expected values live in `derivation-vectors.properties` as data, and the
 * authoritative copies live in the Rust suite
 * `protocol/crates/kovanica-wallet/tests/slip10_vectors.rs`, plus the shared
 * `protocol/testvectors/vectors.json`. Neither is the origin of truth in
 * isolation: if the two ever disagree, SLIP-0010 or the frozen path changed and
 * every client would resolve a different address.
 *
 * After the FFI swap there is no Kotlin crypto left here to test, which is the
 * point: these assertions exercise the Rust core through the UniFFI surface, so
 * they pin the exact boundary the app calls.
 */
class KovanicaKeysTest {

    /** Zero-entropy phrase, the input the vectors in `material` were made from. */
    private val phrase: String = (List(11) { "abandon" } + "about").joinToString(" ")

    private val vectors: Properties =
        Properties().apply {
            val loader = checkNotNull(KovanicaKeysTest::class.java.classLoader)
            val stream = checkNotNull(loader.getResourceAsStream("derivation-vectors.properties"))
            stream.use { load(it) }
                ?: error("derivation-vectors.properties missing from test resources")
        }

    private fun expect(index: Int, field: String): String = vectors.str("index.$index.$field")

    // --- frozen constants -------------------------------------------------

    @Test
    fun `frozen path constants match the spec`() {
        assertEquals(3007, KovanicaKeys.SLIP44_COIN_TYPE)
        assertEquals(0, KovanicaKeys.DERIVATION_ACCOUNT)
        assertEquals(0, KovanicaKeys.DEFAULT_ADDRESS_INDEX)
        assertEquals("m/44'/3007'/0'/0'/i'", KovanicaKeys.DERIVATION_PATH)
        assertEquals(3007, KovanicaKeys.coinType())
        assertEquals("m/44'/3007'/0'/0'/0'", KovanicaKeys.derivationPath(0))
    }

    // --- derivation through the FFI ---------------------------------------

    @Test
    fun `derives the pinned signing key at each index`() {
        for (index in 0..2) {
            assertEquals(
                "index $index",
                expect(index, "key"),
                KovanicaKeys.signingKeyHex(phrase, index = index),
            )
        }
    }

    @Test
    fun `derives the pinned address end to end`() {
        for (index in 0..2) {
            val address = KovanicaKeys.addressFromMnemonic(phrase, index = index)
            assertEquals("index $index hex", expect(index, "hex"), address.hex)
            assertEquals("index $index kvnc", expect(index, "kvnc"), address.kvnc)
        }
    }

    @Test
    fun `distinct indices yield distinct addresses`() {
        val seen = (0..2).map { KovanicaKeys.addressFromMnemonic(phrase, index = it).kvnc }
        assertEquals("every index must be distinct", seen.size, seen.toSet().size)
    }

    @Test
    fun `a signing key resolves back to its address`() {
        val address = KovanicaKeys.addressFromSigningKeyHex(expect(0, "key"))
        assertEquals(expect(0, "kvnc"), address.kvnc)
        assertEquals(expect(0, "hex"), address.hex)
    }

    // --- the regression this class exists to prevent ----------------------

    @Test
    fun `slip10 output differs from the truncated material`() {
        // Truncating the 64-byte stretched material to 32 bytes and using that
        // as the signing key is the historical bug. It produced a different,
        // unspendable address for the same recovery phrase.
        assertNotEquals(vectors.str("material").take(64), expect(0, "key"))
    }

    @Test
    fun `rejects an out of range address index`() {
        assertThrows(IllegalArgumentException::class.java) {
            KovanicaKeys.signingKeyHex(phrase, index = -1)
        }
        // Int.MIN_VALUE: negative, and the one value that would wrap into a
        // legitimate u32 index if the wrapper did not gate it.
        assertThrows(IllegalArgumentException::class.java) {
            KovanicaKeys.signingKeyHex(phrase, index = Int.MIN_VALUE)
        }
    }

    @Test
    fun `rejects a malformed signing key`() {
        for (bad in listOf("", "aabb", "0".repeat(63))) {
            assertThrows("signing key '$bad'", DerivationException::class.java) {
                KovanicaKeys.addressFromSigningKeyHex(bad)
            }
        }
    }

    @Test
    fun `validates phrases through the core`() {
        assertTrue(KovanicaKeys.isValidPhrase(phrase))
        assertFalse(KovanicaKeys.isValidPhrase(""))
        assertFalse(KovanicaKeys.isValidPhrase("not a real phrase"))
    }

    // --- shared golden vectors (protocol/testvectors/vectors.json) --------

    /**
     * Consume the canonical vector file generated from the Rust core. The file
     * is wired into test resources by `sourceSets.test.resources.srcDir(...)`
     * in `app/build.gradle.kts`, so this reads the one true copy — no duplication.
     */
    @Test
    fun `shared golden vectors match the frozen derivation`() {
        val loader = checkNotNull(KovanicaKeysTest::class.java.classLoader)
        val stream = checkNotNull(loader.getResourceAsStream("vectors.json")) {
            "vectors.json missing from test resources"
        }
        val doc = JSONObject(stream.bufferedReader().use { it.readText() })
        val vectors = doc.getJSONArray("vectors")

        var checked = 0
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            if (v.getString("kind") != "derivation") continue
            val name = v.getString("name")
            val account =
                KovanicaKeys.accountFromMnemonic(
                    v.getString("mnemonic"),
                    v.getString("passphrase"),
                    v.getInt("index"),
                )
            assertEquals("$name address", v.getString("address"), account.address)
            assertEquals("$name pubkey", v.getString("pubkey_hex"), account.publicKeyHex)
            assertEquals(
                "$name address_hex",
                v.getString("address_hex"),
                KovanicaAddress.fromAccount(account).hex,
            )
            checked++
        }
        assertTrue("expected derivation vectors in vectors.json", checked > 0)
    }

    // --- helpers ----------------------------------------------------------

    private fun Properties.str(key: String): String =
        getProperty(key)?.trim() ?: error("missing vector $key")
}
