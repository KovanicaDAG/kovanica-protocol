package com.kovanica.wallet.util

import android.content.Context
import com.kovanica.lightnode.ui.util.Bip39
import java.security.SecureRandom

/**
 * BIP-39 mnemonic utilities for wallet creation and restoration.
 * Uses the internal pure-Kotlin BIP-39 implementation (com.kovanica.lightnode.ui.util.Bip39)
 * which depends on BouncyCastle (already in project dependencies).
 */
object MnemonicUtil {

    private val random = SecureRandom()

    /**
     * Generate a new 12-word BIP-39 mnemonic (128-bit entropy).
     * Requires a Context to load the word list from assets.
     */
    fun generateMnemonic(context: Context): String {
        return Bip39(context).generateMnemonic()
    }

    /**
     * Generate a new 24-word BIP-39 mnemonic (256-bit entropy).
     * Requires a Context to load the word list from assets.
     */
    fun generateMnemonic24(context: Context): String {
        return Bip39(context).generateMnemonic(256)
    }

    /**
     * Validate a BIP-39 mnemonic phrase.
     * Requires a Context to load the word list from assets.
     */
    fun validateMnemonic(context: Context, phrase: String): Boolean {
        return Bip39(context).validate(phrase)
    }

    /**
     * Convert mnemonic to seed bytes (with optional passphrase).
     * Requires a Context to load the word list from assets.
     */
    fun mnemonicToSeed(context: Context, phrase: String, passphrase: String = ""): ByteArray {
        return Bip39(context).mnemonicToSeed(phrase, passphrase)
    }
}