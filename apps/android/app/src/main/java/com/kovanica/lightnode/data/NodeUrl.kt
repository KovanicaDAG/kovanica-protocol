package com.kovanica.lightnode.data

import android.content.Context
import com.kovanica.lightnode.ui.prefs.WalletPrefs

/**
 * Lightweight value wrapper around the configured seed-node URL.
 *
 * The canonical source is [WalletPrefs]; callers use this class to build
 * `/api/...` paths without scattering string concatenation across the app.
 */
@JvmInline
value class NodeUrl(private val baseUrl: String) {

    /**
     * Build a full URL for an API path. [path] must start with `/`.
     */
    fun apiPath(path: String): String {
        require(path.startsWith("/")) { "API path must start with /" }
        return baseUrl.trimEnd('/') + path
    }

    companion object {
        /**
         * Read the current node URL from [WalletPrefs].
         */
        fun fromPrefs(context: Context): NodeUrl {
            return NodeUrl(WalletPrefs(context).nodeUrl)
        }
    }
}
