package com.kovanica.wallet

import android.app.Application
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class KovanicaWalletApplication : Application() {

    companion object {
        const val LIGHT_SYNC_FILE = "light_sync.bin"
        const val PREFS_NAME = "wallet_prefs"
    }

    val dataStore by lazy { preferencesDataStore(PREFS_NAME) }
    val ioScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    val uiScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    override fun onTerminate() {
        ioScope.cancel()
        uiScope.cancel()
        super.onTerminate()
    }
}