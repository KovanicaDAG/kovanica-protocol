package com.kovanica.lightnode

import android.app.Application
import android.content.Context
import androidx.work.WorkManager
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Executors
import uniffi.kovanica.LightConfig
import uniffi.kovanica.LightNode

class KovanicaApplication : Application() {

    private var lightNode: LightNode? = null
    private val syncDispatcher: CoroutineDispatcher by lazy {
        Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    }

    override fun onCreate() {
        super.onCreate()
        // Schedule background workers
        scheduleBackgroundWorkers()
    }

    /**
     * Get or create the LightNode instance with live network parameters.
     * Must be called from syncDispatcher context.
     */
    suspend fun getOrCreateLightNode(): LightNode = withContext(syncDispatcher) {
        if (lightNode != null) return@withContext lightNode!!
        
        // Live network parameters (from /api/bootstrap + /api/state)
        // k=3, subsidy=10*ATOM, founder_amount=200_000*ATOM (0.2M KVNC), founder_seed=1, pruning MAX
        val config = LightConfig(
            k = 3,
            subsidy = 1_000_000_000L, // 10 KVNC in atoms
            founderAmount = 20_000_000_000_000L, // 200,000 KVNC (0.2M) in atoms
            founderSeed = 1,
            finalityDepth = Long.MAX_VALUE, // MAX pruning
            payloadPruningDepth = Long.MAX_VALUE
        )
        
        val node = LightNode(config)
        lightNode = node
        node
    }

    fun getSyncDispatcher() = syncDispatcher

    /** Schedule background workers (sync + staking) */
    private fun scheduleBackgroundWorkers() {
        try {
            com.kovanica.lightnode.work.SyncWorker.schedule(this)
            // StakingWorker only scheduled when validator is active (handled by WalletRepository)
        } catch (e: Exception) {
            // WorkManager may not be initialized yet in some test contexts
        }
    }

    /** Cancel all background workers */
    fun cancelBackgroundWorkers() {
        try {
            com.kovanica.lightnode.work.SyncWorker.cancel(this)
            com.kovanica.lightnode.work.StakingWorker.cancel(this)
        } catch (e: Exception) {
            // Ignore
        }
    }

    /** Enable/disable staking worker based on validator status */
    fun setStakingWorkerEnabled(enabled: Boolean) {
        if (enabled) {
            com.kovanica.lightnode.work.StakingWorker.schedule(this)
        } else {
            com.kovanica.lightnode.work.StakingWorker.cancel(this)
        }
    }

    override fun onTerminate() {
        cancelBackgroundWorkers()
        syncDispatcher.close()
        super.onTerminate()
    }

    companion object {
        const val LIGHT_SYNC_FILE = "light_sync.bin"
        const val OPERATOR_WALLET_FILE = "operator_wallet.key"

        /** Get sync dispatcher from application context */
        fun getSyncDispatcher(context: Context): CoroutineDispatcher {
            return (context.applicationContext as KovanicaApplication).syncDispatcher
        }
    }
}