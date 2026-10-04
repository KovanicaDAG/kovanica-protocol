package com.kovanica.wallet.util

import android.content.Context
import com.kovanica.lightnode.ui.util.Bip39

/**
 * BIP-39 mnemonic utilities for wallet creation and restoration.
 *
 * Generation lives here because the Rust core has no mnemonic-generator export
 * yet; every other mnemonic operation (validation, stretching, derivation)
 * goes through the FFI, so there is one implementation of each.
 */
object MnemonicUtil {

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
}