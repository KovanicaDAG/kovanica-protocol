package com.kovanica.wallet.data

import com.kovanica.wallet.model.AddressInfo
import com.kovanica.wallet.model.BootstrapInfo
import com.kovanica.wallet.model.FeeEstimate
import com.kovanica.wallet.model.HeadInfo
import com.kovanica.wallet.model.HistoryEntry
import com.kovanica.wallet.model.Utxo
import org.json.JSONObject

/**
 * Aggregates reads from the Kovanica node API for a given watch address.
 * v1 is read-only + receive + faucet.
 */
class WalletRepository(
    private val api: KovApi,
    private val seedStore: SeedStore,
) {

    val address: String
        get() = seedStore.address

    fun setAddress(addr: String) {
        seedStore.address = addr.trim()
    }

    suspend fun loadHead(): HeadInfo = api.head()

    suspend fun loadBootstrap(): BootstrapInfo = api.bootstrap()

    suspend fun loadFeeEstimate(): FeeEstimate = api.feeEstimate()

    suspend fun loadAddress(): AddressInfo = api.address(address)

    suspend fun loadHistory(limit: Int, offset: Int): List<HistoryEntry> =
        api.history(address, limit, offset)

    suspend fun loadUtxos(limit: Int): List<Utxo> = api.utxos(address, limit)

    suspend fun requestFaucet(): JSONObject = api.faucet(address)
}
