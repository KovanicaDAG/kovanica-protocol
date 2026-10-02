package com.kovanica.lightnode.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asLiveData
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody
import uniffi.kovanica.LightNode
import uniffi.kovanica.LightConfig
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * Repository owning the in-process LightNode and persisting the KVLS v1
 * light-sync blob to filesDir/light_sync.bin.
 * 
 * Startup calls receiveLightSync on the saved blob; sync(nodeUrl, walletAddress)
 * fetches /api/light_sync?from=<tip>, merges it, writes the merged blob back,
 * then checks Golomb-Rice filters with syncedFilterMatches and pulls only
 * matching full blocks via /api/blocks?from=<id>.
 */
class LightNodeRepository(
    private val context: Context,
    private val syncDispatcher: CoroutineDispatcher,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
) {

    private val dataStore = context.preferencesDataStore("lightnode_prefs")
    private val _nodeState = MutableLiveData<NodeState>()
    val nodeState: LiveData<NodeState> = _nodeState

    private var lightNode: LightNode? = null
    private var nodeUrl: String = "https://explorer.kovanica.online"
    private var walletAddress: String? = null

    data class NodeState(
        val isInitialized: Boolean = false,
        val isSyncing: Boolean = false,
        val blockHeight: Long = 0,
        val tipHash: String = "",
        val peerCount: Int = 0,
        val lastError: String? = null,
        val isStaking: Boolean = false
    )

    /** Initialize or restore LightNode from persisted snapshot. */
    suspend fun initialize(): Result<Unit> = withContext(syncDispatcher) {
        try {
            val lightSyncFile = File(context.filesDir, KovanicaApplication.LIGHT_SYNC_FILE)
            val config = LightConfig(
                k = 3,
                subsidy = 20_000_000_000L,
                founderAmount = 20_000_000_000L,
                founderSeed = 1,
                finalityDepth = Long.MAX_VALUE,
                payloadPruningDepth = Long.MAX_VALUE
            )
            val node = LightNode(config)
            lightNode = node

            // Load persisted light-sync blob if exists
            if (lightSyncFile.exists()) {
                val blob = lightSyncFile.readBytes()
                try {
                    node.receiveLightSync(blob)
                    _nodeState.postValue(NodeState(
                        isInitialized = true,
                        blockHeight = node.tipHeight(),
                        tipHash = node.tipHash()
                    ))
                } catch (e: Exception) {
                    // Blob corrupted or stale — delete and re-sync
                    lightSyncFile.delete()
                }
            } else {
                _nodeState.postValue(NodeState(isInitialized = true))
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Set the node URL and wallet address for sync targeting. */
    suspend fun setNodeUrl(url: String) = withContext(syncDispatcher) {
        nodeUrl = url
    }

    suspend fun setWalletAddress(address: String?) = withContext(syncDispatcher) {
        walletAddress = address
    }

    /** Full sync: fetch /api/light_sync, merge, then pull matching blocks via /api/blocks. */
    suspend fun sync(): Result<SyncResult> = withContext(syncDispatcher) {
        val node = lightNode ?: return Result.failure(IllegalStateException("LightNode not initialized"))
        
        _nodeState.postValue(_nodeState.value?.copy(isSyncing = true))

        try {
            // 1. Get current tip from node
            val currentTip = node.tipHash()
            
            // 2. Fetch light sync blob from /api/light_sync?from=<tip>
            val syncBlob = fetchLightSyncBlob(currentTip)
                ?: return Result.failure(Exception("Failed to fetch light sync blob"))
            
            // 3. Merge the blob
            node.receiveLightSync(syncBlob)
            
            // 4. Check filters for wallet address (if set)
            var blocksPulled = 0
            walletAddress?.let { addr ->
                if (node.syncedFilterMatches(syncBlob, addr)) {
                    // Pull matching full blocks
                    blocksPulled = pullMatchingBlocks(addr).getOrElse { 0 }
                }
            }
            
            // 5. Persist merged blob
            saveLightSyncBlob(node)
            
            val newHeight = node.tipHeight()
            val newTip = node.tipHash()
            _nodeState.postValue(NodeState(
                isInitialized = true,
                blockHeight = newHeight,
                tipHash = newTip,
                isSyncing = false
            ))
            
            Result.success(SyncResult(newHeight, newTip, blocksPulled))
        } catch (e: Exception) {
            _nodeState.postValue(NodeState(
                isInitialized = true,
                isSyncing = false,
                lastError = e.message
            ))
            Result.failure(e)
        }
    }

    /** Fetch KVLS v1 light-sync blob from /api/light_sync?from=<tip> */
    private suspend fun fetchLightSyncBlob(fromTip: String): ByteArray? = withContext(Dispatchers.IO) {
        val url = "$nodeUrl/api/light_sync?from=$fromTip"
        val request = Request.Builder().url(url).build()
        httpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                response.body?.readBytes()
            } else {
                null
            }
        }
    }

    /** Pull matching full blocks via /api/blocks?from=<id> */
    private suspend fun pullMatchingBlocks(address: String): Result<Int> = withContext(Dispatchers.IO) {
        val node = lightNode ?: return Result.failure(IllegalStateException("Node not initialized"))
        // Get filter matches to know which blocks to pull
        // For v0.1, we pull from the last known tip if filter matches
        try {
            val blocksUrl = "$nodeUrl/api/blocks?from=${node.tipHash()}"
            val request = Request.Builder().url(blocksUrl).build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val blob = response.body?.readBytes()
                    blob?.let { node.receiveBlocks(it) }
                }
            }
            Result.success(1) // simplified
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Persist light sync blob to filesDir/light_sync.bin */
    private fun saveLightSyncBlob(node: LightNode) {
        try {
            val file = File(context.filesDir, KovanicaApplication.LIGHT_SYNC_FILE)
            val blob = node.exportLightSync()
            FileOutputStream(file).use { it.write(blob) }
        } catch (e: Exception) {
            // Log but don't crash
        }
    }

    /** Get balance for address */
    suspend fun balanceOf(address: String): Result<Long> = withContext(syncDispatcher) {
        val node = lightNode ?: return Result.failure(IllegalStateException("Not initialized"))
        try {
            Result.success(node.balanceOfAddress(address))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Get history for address */
    suspend fun historyOf(address: String, maxBlocks: Int = 100): Result<List<HistoryEntry>> = withContext(syncDispatcher) {
        val node = lightNode ?: return Result.failure(IllegalStateException("Not initialized"))
        try {
            val history = node.historyOf(address, maxBlocks)
            Result.success(history.map { HistoryEntry(
                txId = it.txIdHex(),
                blockId = it.blockIdHex(),
                amount = it.amountAtoms.toString(),
                direction = if (it.isReceived) "received" else "sent",
                timestamp = it.timestampMs
            ) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Send from seed */
    suspend fun sendFrom(secretHex: String, amountAtoms: Long, toAddress: String): Result<String> = withContext(syncDispatcher) {
        val node = lightNode ?: return Result.failure(IllegalStateException("Not initialized"))
        try {
            Result.success(node.sendFrom(secretHex, amountAtoms, toAddress))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Bond stake */
    suspend fun bondStake(secretHex: String, amountAtoms: Long): Result<Unit> = withContext(syncDispatcher) {
        val node = lightNode ?: return Result.failure(IllegalStateException("Not initialized"))
        try {
            node.bondStake(secretHex, amountAtoms)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Produce a block (for staking) */
    suspend fun produceBlock(): Result<String> = withContext(syncDispatcher) {
        val node = lightNode ?: return Result.failure(IllegalStateException("Not initialized"))
        try {
            val blockId = node.produceBlock()
            _nodeState.postValue(_nodeState.value?.copy(blockHeight = node.tipHeight()))
            Result.success(blockId)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    data class SyncResult(
        val height: Long,
        val tipHash: String,
        val blocksPulled: Int
    )

    data class HistoryEntry(
        val txId: String,
        val blockId: String,
        val amount: String,
        val direction: String,
        val timestamp: Long
    )
}