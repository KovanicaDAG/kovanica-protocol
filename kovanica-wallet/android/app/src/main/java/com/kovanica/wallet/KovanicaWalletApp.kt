package com.kovanica.wallet

import android.app.Application
import com.kovanica.wallet.data.KovApi
import com.kovanica.wallet.data.SeedStore
import com.kovanica.wallet.data.WalletRepository

class KovanicaWalletApp : Application() {

    @Volatile
    var nodeUrl: String = KovApi.KOVANICA_API_DEFAULT
        set(value) {
            field = value.trim().ifBlank { KovApi.KOVANICA_API_DEFAULT }
            repository = null
        }

    @Volatile
    var repository: WalletRepository? = null
        private set

    fun repository(): WalletRepository {
        return repository ?: synchronized(this) {
            repository ?: buildRepository().also { repository = it }
        }
    }

    private fun buildRepository(): WalletRepository {
        val store = SeedStore(this)
        val kovApi = KovApi(baseUrlProvider = { nodeUrl })
        return WalletRepository(kovApi, store)
    }
}
