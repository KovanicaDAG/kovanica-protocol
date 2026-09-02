package com.kovanica.lightnode.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.kovanica.lightnode.data.LightNodeRepository
import com.kovanica.lightnode.data.formatKvnc
import com.kovanica.lightnode.ui.prefs.WalletPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.kovanica.TxDirection

/**
 * Periodic background worker that light-syncs the wallet and posts local
 * notifications for interesting events:
 *
 * - newly received funds (covers mining rewards and faucet drops)
 * - matured unbonds
 *
 * Constraints are configured by [SyncWorkScheduler] (network + charging).
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = WalletPrefs(applicationContext)
        if (!prefs.backgroundSyncEnabled) {
            return@withContext Result.success()
        }

        val nodeUrl = prefs.nodeUrl
        val address = prefs.walletAddressHex
        if (address.isNullOrBlank()) {
            // No wallet yet; retry later in case one is imported.
            return@withContext Result.retry()
        }

        NotificationHelper.createChannel(applicationContext)

        val repository = LightNodeRepository.getInstance(applicationContext)
        try {
            val previousTxIds = prefs.lastHistoryTxIds
            val previousPendingHeight = prefs.lastPendingUnbondHeight

            val syncResult = repository.sync(nodeUrl, address)
            if (syncResult.isFailure) {
                return@withContext Result.retry()
            }

            val history = repository.historyOf(address, HISTORY_LIMIT).getOrDefault(emptyList())
            val pendingHeight = repository.pendingUnbondHeight().getOrNull()
            val syncedHeight = repository.syncedHeight().getOrNull()

            val currentTxIds = history.map { it.txIdHex }.toSet()

            // Notify about every newly seen incoming transaction. We skip the
            // first run (empty previous snapshot) so importing an old wallet
            // does not spam the user with ancient history.
            if (previousTxIds.isNotEmpty()) {
                history
                    .filter {
                        it.direction == TxDirection.RECEIVED &&
                            !previousTxIds.contains(it.txIdHex)
                    }
                    .forEach { entry ->
                        NotificationHelper.showNotification(
                            applicationContext,
                            entry.txIdHex.hashCode(),
                            "Kovanica received",
                            "+${formatKvnc(entry.amount)}",
                        )
                    }
            }

            // Notify when a previously tracked unbond matures.
            if (previousPendingHeight != null) {
                val matured = pendingHeight == null ||
                    (syncedHeight != null && syncedHeight >= previousPendingHeight.toLongOrNull(Long.MAX_VALUE))
                if (matured) {
                    NotificationHelper.showNotification(
                        applicationContext,
                        NOTIFY_ID_UNBOND,
                        "Stake unbonded",
                        "Your unbonded stake is now mature and spendable.",
                    )
                    prefs.lastPendingUnbondHeight = null
                } else if (pendingHeight != null) {
                    prefs.lastPendingUnbondHeight = pendingHeight
                }
            } else if (pendingHeight != null) {
                prefs.lastPendingUnbondHeight = pendingHeight
            }

            prefs.lastHistoryTxIds = currentTxIds

            Result.success()
        } finally {
            repository.close()
        }
    }

    private fun String?.toLongOrNull(default: Long): Long = this?.toLongOrNull() ?: default

    companion object {
        const val WORK_NAME = "kovanica_background_sync"
        private const val HISTORY_LIMIT = 100u
        private const val NOTIFY_ID_UNBOND = 2
    }
}
