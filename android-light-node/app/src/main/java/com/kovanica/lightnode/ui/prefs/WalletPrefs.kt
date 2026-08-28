package com.kovanica.lightnode.ui.prefs

import android.content.Context
import android.content.SharedPreferences

/**
 * Plaintext preferences for wallet-level settings.
 *
 * The mnemonic is no longer stored here; use [com.kovanica.lightnode.data.SecureSeedStorage]
 * for the encrypted seed phrase.
 */
class WalletPrefs(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var nodeUrl: String
        get() = prefs.getString(KEY_NODE_URL, DEFAULT_NODE_URL) ?: DEFAULT_NODE_URL
        set(value) = prefs.edit().putString(KEY_NODE_URL, value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS_NAME = "kovanica_wallet"
        private const val KEY_NODE_URL = "node_url"
        const val DEFAULT_NODE_URL = "https://explorer.kovanica.online"
    }
}
