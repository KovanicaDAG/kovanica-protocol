package com.kovanica.wallet.data

import android.content.Context
import android.content.SharedPreferences

/**
 * v1 read-only wallet: stores only a display address (and optional mnemonic
 * placeholder) used as the watch/receive address. No private keys are stored
 * or derived here — signing is a documented follow-up needing a crypto binding.
 * Plain SharedPreferences is acceptable for v1.
 */
class SeedStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var address: String
        get() = prefs.getString(KEY_ADDRESS, null).orEmpty()
        set(value) = prefs.edit().putString(KEY_ADDRESS, value).apply()

    val hasAddress: Boolean
        get() = address.isNotBlank()

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS_NAME = "kovanica_wallet_seed"
        private const val KEY_ADDRESS = "watch_address"
    }
}
