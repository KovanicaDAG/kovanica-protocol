package com.kovanica.lightnode.ui.util

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * BIP-39 **mnemonic generation** for the light-node wallet.
 *
 * This class deliberately does not stretch, validate, or derive anything. Seed
 * stretching (PBKDF2), SLIP-0010 ed25519 derivation, address encoding, and
 * phrase validation all live in the Rust core and are reached through
 * [KovanicaKeys] / the UniFFI surface, so there is exactly one implementation
 * of each. A second PBKDF2 here is how the clients drifted apart before.
 *
 * Generation itself has no Rust export yet, so it stays local: entropy from
 * [SecureRandom], checksum from SHA-256, words from `assets/bip39_english.txt`.
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
                index = (index shl 1) or (if (bits[pos]) 1 else 0)
            }
            words[index]
        }
    }

    companion object {
        private const val WORD_LIST_SIZE = 2048
    }
}
