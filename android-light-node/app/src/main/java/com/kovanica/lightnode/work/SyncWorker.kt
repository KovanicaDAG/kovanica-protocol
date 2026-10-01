package com.kovanica.lightnode.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.kovanica.lightnode.data.LightNodeRepository
import com.kovanica.lightnode.KovanicaApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * WorkManager worker for periodic light sync in background.
 * Runs on the application's dedicated sync dispatcher.
 * Constraints: network + charging (to avoid battery drain).
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val app = applicationContext as KovanicaApplication
            val lightNodeRepository = LightNodeRepository(
                applicationContext,
                app.getSyncDispatcher()
            )
            
            // Initialize if needed
            val initResult = lightNodeRepository.initialize()
            if (initResult.isFailure) {
                return@withContext Result.failure()
            }
            
            // Perform sync
            val syncResult = lightNodeRepository.sync()
            
            if (syncResult.isSuccess) {
                Result.success()
            } else {
                Result.retry()
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val WORK_NAME = "kovanica_light_sync"
        const val TAG = "LightSyncWorker"
        
        /** Schedule periodic sync with constraints: network + charging */
        fun schedule(context: Context) {
            val workManager = androidx.work.WorkManager.getInstance(context)
            
            val constraints = androidx.work.Constraints.Builder()
                .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
                .setRequiresCharging(true) // Battery-friendly: only sync when charging
                .build()
            
            val workRequest = androidx.work.PeriodicWorkRequestBuilder<SyncWorker>(
                4, androidx.work.WorkManager.TimeUnit.HOURS // Every 4 hours when charging
            )
                .setConstraints(constraints)
                .addTag(TAG)
                .build()
            
            workManager.enqueueUniquePeriodicWork(
                WORK_NAME,
                androidx.work.ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
        }
        
        /** Cancel scheduled sync */
        fun cancel(context: Context) {
            val workManager = androidx.work.WorkManager.getInstance(context)
            workManager.cancelUniqueWork(WORK_NAME)
        }
    }
}

/**
 * Worker for producing staked blocks when validator is enabled.
 * Runs on the sync dispatcher.
 */
class StakingWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(
        (applicationContext as com.kovanica.lightnode.KovanicaApplication).getSyncDispatcher()
    ) {
        try {
            val app = applicationContext as com.kovanica.lightnode.KovanicaApplication
            val lightNodeRepository = com.kovanica.lightnode.data.LightNodeRepository(
                applicationContext,
                app.getSyncDispatcher()
            )
            
            val initResult = lightNodeRepository.initialize()
            if (initResult.isFailure) {
                return@withContext Result.failure()
            }
            
            // Try to produce a block (staked draw first, PoW fallback)
            val produceResult = lightNodeRepository.produceBlock()
            
            if (produceResult.isSuccess) {
                // Also sync to propagate the block
                lightNodeRepository.sync()
                Result.success()
            } else {
                Result.retry()
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val WORK_NAME = "kovanica_staking"
        const val TAG = "StakingWorker"
        
        /** Schedule periodic staking when validator is active */
        fun schedule(context: Context) {
            val workManager = androidx.work.WorkManager.getInstance(context)
            
            val constraints = androidx.work.Constraints.Builder()
                .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
                .setRequiresCharging(false) // Staking doesn't require charging
                .build()
            
            val workRequest = androidx.work.PeriodicWorkRequestBuilder<StakingWorker>(
                2, androidx.work.WorkManager.TimeUnit.HOURS // Every 2 hours
            )
                .setConstraints(constraints)
                .addTag(TAG)
                .build()
            
            workManager.enqueueUniquePeriodicWork(
                WORK_NAME,
                androidx.work.ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
        }
        
        fun cancel(context: Context) {
            val workManager = androidx.work.WorkManager.getInstance(context)
            workManager.cancelUniqueWork(WORK_NAME)
        }
    }
}