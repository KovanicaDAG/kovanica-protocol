package com.kovanica.lightnode.ui.util

import android.content.Context
import org.bouncycastle.crypto.PBEParametersGenerator
import org.bouncycastle.crypto.digests.SHA512Digest
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.KeyParameter
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Minimal BIP39 implementation for the light-node wallet.
 *
 * The word list is read from `assets/bip39_english.txt`. Only the standard
 * 12-word (128-bit entropy) path is exposed; callers that need 15/18/21/24
 * words can extend [generateMnemonic].
 */
class Bip39(context: Context) {

    private val words: List<String> = context.assets.open("bip39_english.txt")
        .bufferedReader()
        .use { it.readLines() }
        .map { it.trim().lowercase() }
        .filter { it.isNotEmpty() }

    init {
        require(words.size == WORD_LIST_SIZE) {
            "BIP39 English word list must contain $WORD_LIST_SIZE words, found ${words.size}"
        }
    }

    /**
     * Generate a fresh mnemonic. [entropyBits] must be a multiple of 32
     * between 128 and 256 (the default 128 yields 12 words).
     */
    fun generateMnemonic(entropyBits: Int = 128): String {
        require(entropyBits in 128..256 && entropyBits % 32 == 0) {
            "entropyBits must be a multiple of 32 between 128 and 256"
        }

        val entropy = ByteArray(entropyBits / 8).apply { SecureRandom().nextBytes(this) }
        val checksumBits = entropyBits / 32
        val totalBits = entropyBits + checksumBits
        val wordCount = totalBits / 11

        val hash = MessageDigest.getInstance("SHA-256").digest(entropy)
        val bits = BooleanArray(totalBits)

        // Entropy bits, MSB first.
        for (i in 0 until entropyBits) {
            val byteIndex = i / 8
            val bitIndex = 7 - (i % 8)
            bits[i] = (entropy[byteIndex].toInt() shr bitIndex) and 1 == 1
        }
        // Checksum bits, MSB first.
        for (i in 0 until checksumBits) {
            val bitIndex = 7 - i
            bits[entropyBits + i] = (hash[0].toInt() shr bitIndex) and 1 == 1
        }

        return (0 until wordCount).joinToString(" ") { wordIndex ->
            var index = 0
            repeat(11) { bitOffset ->
                val pos = wordIndex * 11 + bitOffset
                index = (index shl 1) or if (bits[pos]) 1 else 0
            }
            words[index]
        }
    }

    /**
     * Validate that [mnemonic] is a syntactically correct BIP39 phrase
     * (word count, word membership and checksum).
     */
    fun validate(mnemonic: String): Boolean {
        val phrase = mnemonic.trim().lowercase().split(Regex("\\s+"))
        if (phrase.isEmpty()) return false
        val wordCount = phrase.size
        if (wordCount !in setOf(12, 15, 18, 21, 24)) return false

        val indexes = phrase.map { word -> words.indexOf(word).takeIf { it >= 0 } ?: return false }
        val entropyBits = wordCount * 11 - (wordCount * 11 / 32)
        val totalBits = wordCount * 11
        val checksumBits = totalBits - entropyBits

        val bits = BooleanArray(totalBits)
        for (i in 0 until wordCount) {
            var value = indexes[i]
            for (j in 10 downTo 0) {
                bits[i * 11 + j] = value and 1 == 1
                value = value shr 1
            }
        }

        val entropy = ByteArray(entropyBits / 8)
        for (i in 0 until entropyBits) {
            val byteIndex = i / 8
            val bitIndex = 7 - (i % 8)
            if (bits[i]) {
                entropy[byteIndex] = (entropy[byteIndex].toInt() or (1 shl bitIndex)).toByte()
            }
        }

        val hash = MessageDigest.getInstance("SHA-256").digest(entropy)
        for (i in 0 until checksumBits) {
            val bitIndex = 7 - i
            val expected = (hash[0].toInt() shr bitIndex) and 1 == 1
            if (bits[entropyBits + i] != expected) return false
        }
        return true
    }

    /**
     * Convert a mnemonic to a 64-byte BIP39 seed. The caller is responsible
     * for clearing the returned array from memory when it is no longer needed.
     */
    fun mnemonicToSeed(mnemonic: String, passphrase: String = ""): ByteArray {
        val password = PBEParametersGenerator.PKCS5PasswordToUTF8Bytes(
            mnemonic.trim().toCharArray()
        )
        val salt = ("mnemonic" + passphrase).toByteArray(Charsets.UTF_8)
        val generator = PKCS5S2ParametersGenerator(SHA512Digest())
        generator.init(password, salt, PBKDF2_ITERATIONS)
        val params = generator.generateDerivedMacParameters(512) as KeyParameter
        return params.key
    }

    /**
     * Convenience: return the first 32 bytes of the BIP39 seed, suitable as
     * an Ed25519 secret seed for the Kovanica FFI.
     */
    fun mnemonicToEd25519Seed(mnemonic: String, passphrase: String = ""): ByteArray {
        return mnemonicToSeed(mnemonic, passphrase).copyOfRange(0, 32)
    }

    companion object {
        private const val WORD_LIST_SIZE = 2048
        private const val PBKDF2_ITERATIONS = 2048
    }
}
