package com.kovanica.lightnode.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules and cancels the periodic background sync worker.
 *
 * The worker runs at most once every 15 minutes (WorkManager's minimum
 * allowed interval) but only when the device is charging and has a network
 * connection, keeping battery impact low.
 */
object SyncWorkScheduler {

    /**
     * Enqueue a unique periodic sync. Subsequent calls are no-ops unless the
     * existing work is cancelled first (ExistingPeriodicWorkPolicy.KEEP).
     */
    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresCharging(true)
            .build()

        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .addTag(SyncWorker.WORK_NAME)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SyncWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    /**
     * Cancel the periodic sync (used when the wallet is reset).
     */
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(SyncWorker.WORK_NAME)
    }
}
