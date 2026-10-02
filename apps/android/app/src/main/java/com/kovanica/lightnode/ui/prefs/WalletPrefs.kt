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

    /**
     * Last block id we successfully light-synced to. Used as the `from`
     * parameter for incremental sync so restarts do not re-fetch history
     * from genesis.
     */
    var lastSyncedBlockId: String?
        get() = prefs.getString(KEY_LAST_SYNCED_BLOCK_ID, null)
        set(value) = prefs.edit().putString(KEY_LAST_SYNCED_BLOCK_ID, value).apply()

    /**
     * The wallet address used by the background sync worker. Stored so the
     * worker does not need to decrypt the mnemonic just to know what to sync.
     */
    var walletAddressHex: String?
        get() = prefs.getString(KEY_WALLET_ADDRESS_HEX, null)
        set(value) = prefs.edit().putString(KEY_WALLET_ADDRESS_HEX, value).apply()

    /**
     * Snapshot of the transaction ids we have already seen. Used by the
     * background sync worker to detect newly incoming funds.
     */
    var lastHistoryTxIds: Set<String>
        get() = prefs.getStringSet(KEY_LAST_HISTORY_TX_IDS, emptySet()) ?: emptySet()
        set(value) = prefs.edit().putStringSet(KEY_LAST_HISTORY_TX_IDS, value).apply()

    /**
     * Last observed pending-unbond height. Used to detect when a bonded stake
     * unlock matures.
     */
    var lastPendingUnbondHeight: String?
        get() = prefs.getString(KEY_LAST_PENDING_UNBOND_HEIGHT, null)
        set(value) = prefs.edit().putString(KEY_LAST_PENDING_UNBOND_HEIGHT, value).apply()

    /**
     * Master switch for the background sync worker. Defaults to true so new
     * wallets benefit from background notifications out of the box.
     */
    var backgroundSyncEnabled: Boolean
        get() = prefs.getBoolean(KEY_BACKGROUND_SYNC_ENABLED, true)
        set(value) = prefs.edit().putBoolean(KEY_BACKGROUND_SYNC_ENABLED, value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS_NAME = "kovanica_wallet"
        private const val KEY_NODE_URL = "node_url"
        private const val KEY_LAST_SYNCED_BLOCK_ID = "last_synced_block_id"
        private const val KEY_WALLET_ADDRESS_HEX = "wallet_address_hex"
        private const val KEY_LAST_HISTORY_TX_IDS = "last_history_tx_ids"
        private const val KEY_LAST_PENDING_UNBOND_HEIGHT = "last_pending_unbond_height"
        private const val KEY_BACKGROUND_SYNC_ENABLED = "background_sync_enabled"
        const val DEFAULT_NODE_URL = "https://explorer.kovanica.online"
    }
}
