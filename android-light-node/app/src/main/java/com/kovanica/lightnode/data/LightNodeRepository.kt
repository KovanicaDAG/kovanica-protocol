package com.kovanica.lightnode.data

import android.content.Context
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject
import uniffi.kovanica.BlockInfo
import uniffi.kovanica.HistoryEntry
import uniffi.kovanica.LightConfig
import uniffi.kovanica.LightNode
import uniffi.kovanica.SendReceipt
import uniffi.kovanica.U128Parts

private const val ATOM: ULong = 100_000_000uL
private const val LIGHT_SYNC_FILE = "light_sync.bin"
private const val HEADER_SIZE = 160
private const val FILTER_PREFIX_SIZE = 13

/**
 * Built-in testnet genesis defaults. Mirrors the live network genesis as
 * proven by `crates/kovanica-ffi/tests/live_sync_spike.rs`.
 */
private fun defaultConfig() = LightConfig(
    k = 3u.toUShort(),
    subsidy = 200uL * ATOM,
    founderAmount = 200uL * ATOM,
    founderSeed = 1u.toULong(),
    finalityDepth = ULong.MAX_VALUE,
    payloadPruningDepth = ULong.MAX_VALUE,
)

/**
 * Single owner of the in-process [LightNode], the persisted light-sync blob,
 * and the dedicated FFI dispatcher.
 *
 * All Rust calls are serialized through one background thread because the node
 * is order-sensitive and CPU-bound. HTTP transport is handled by [NodeClient]
 * and only raw byte blobs cross into the FFI layer.
 */
class LightNodeRepository(context: Context) {

    private val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val prefs = com.kovanica.lightnode.ui.prefs.WalletPrefs(context)
    private val lightSyncFile = File(context.filesDir, LIGHT_SYNC_FILE)

    private var lightConfig: LightConfig = defaultConfig()
    private var configFetched: Boolean = false

    private val node: LightNode by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        LightNode(lightConfig)
    }

    /**
     * Ensure the node is constructed. On first boot the configuration is
     * fetched from [nodeUrl]/api/bootstrap and cached. If the bootstrap call
     * fails for any reason, the built-in testnet defaults are used so the app
     * remains usable offline. Safe to call repeatedly.
     */
    suspend fun bootIfNeeded(nodeUrl: String) = withContext(dispatcher) {
        if (!configFetched) {
            lightConfig = runCatching { fetchLightConfig(nodeUrl) }.getOrDefault(defaultConfig())
            configFetched = true
        }
        node
    }

    /**
     * Load a previously persisted light-sync blob (if any) into the node.
     * Call this once at startup, before any incremental sync.
     */
    suspend fun loadLightSync(): Result<Unit> = withContext(dispatcher) {
        runCatching {
            if (!lightSyncFile.exists() || lightSyncFile.length() == 0L) {
                return@runCatching
            }
            val bytes = lightSyncFile.readBytes()
            node.receiveLightSync(bytes)
            Unit
        }.mapNodeError()
    }

    /**
     * Incremental light sync against [nodeUrl]:
     *
     * 1. Load any persisted light-sync blob.
     * 2. Fetch the incremental KVLS blob from `/api/light_sync?from=<tip>`.
     * 3. Apply it with `receiveLightSync`.
     * 4. Export the merged header chain and write it back to disk.
     * 5. Check filters of the newly synced headers for [walletAddress]; on
     *    any match, fetch the corresponding full blocks and feed them to
     *    `receiveBlocks`.
     *
     * Returns the number of newly synced headers in this incremental batch.
     */
    suspend fun sync(nodeUrl: String, walletAddress: String): Result<Int> =
        withContext(dispatcher) {
            runCatching {
                bootIfNeeded(nodeUrl)
                loadLightSync().getOrThrow()

                // If the node is cold (no persisted blob), fall back to the
                // last synced block id stored in preferences.
                val fromId = node.syncedTipId() ?: prefs.lastSyncedBlockId
                val client = NodeClient(nodeUrl)
                val incrementalBlob = client.fetchLightSync(fromId).getOrThrow()
                val newHeaders = parseLightSyncHeaders(incrementalBlob)

                node.receiveLightSync(incrementalBlob)

                // Persist the merged header chain so restarts are cheap.
                val mergedBlob = node.exportLightSync()
                lightSyncFile.writeBytes(mergedBlob)
                prefs.lastSyncedBlockId = node.syncedTipId()

                // Pull full blocks only for headers whose filters hit the
                // wallet address.
                val matched = newHeaders.filter { header ->
                    node.syncedFilterMatches(header.id, walletAddress) == true
                }
                if (matched.isNotEmpty()) {
                    val earliest = matched.minByOrNull { it.height } ?: matched.first()
                    val fullFrom = earliest.prevHash ?: fromId
                    val fullBlocks = client.fetchBlocks(fullFrom).getOrThrow()
                    node.receiveBlocks(fullBlocks)
                }

                newHeaders.size
            }.mapNodeError()
        }

    /**
     * Spendable balance of [address] in atoms as a decimal string.
     */
    suspend fun balanceOfAddress(address: String): Result<String> =
        withContext(dispatcher) {
            runCatching { node.balanceOfAddress(address) }.mapNodeError()
        }

    /**
     * Recent history for [address] across up to [maxBlocks] blocks.
     */
    suspend fun historyOf(address: String, maxBlocks: UInt): Result<List<HistoryEntry>> =
        withContext(dispatcher) {
            runCatching { node.historyOf(address, maxBlocks) }.mapNodeError()
        }

    /**
     * UTXOs for [address] as a JSON string from the seed node.
     *
     * The FFI surface does not expose a direct UTXO list, so this delegates to
     * the HTTP endpoint.
     */
    suspend fun utxosOf(address: String): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching {
                NodeClient(prefs.nodeUrl).fetchUtxos(address, 100, 0).getOrThrow()
            }.mapNodeError()
        }

    /**
     * Highest height among light-synced headers, if any.
     */
    suspend fun syncedHeight(): Result<Long?> =
        withContext(dispatcher) { Result.success(node.syncedHeight()?.toLong()) }

    /**
     * Id of the highest light-synced header, if any.
     */
    fun syncedTipId(): String? = node.syncedTipId()

    /**
     * Apply a full-block blob to the node.
     */
    suspend fun receiveBlocks(blob: ByteArray): Result<Int> =
        withContext(dispatcher) {
            runCatching { node.receiveBlocks(blob).toInt() }.mapNodeError()
        }

    // ------------------------------------------------------------------
    // Wallet-facing operations (used by [WalletRepository])
    // ------------------------------------------------------------------

    /**
     * Transfer [amountAtoms] atoms from the 32-byte Ed25519 secret [secretHex]
     * to [toAddress].
     */
    suspend fun sendFrom(
        secretHex: String,
        amountAtoms: ULong,
        toAddress: String,
    ): Result<SendReceipt> = withContext(dispatcher) {
        runCatching { node.sendFrom(secretHex, amountAtoms, toAddress) }.mapNodeError()
    }

    /**
     * Bond [amountAtoms] atoms to this node's validator identity. The spending
     * actor is identified by a [ULong] seed.
     */
    suspend fun bondStake(seed: ULong, amountAtoms: ULong): Result<String> =
        withContext(dispatcher) {
            runCatching { node.bondStake(seed, amountAtoms) }.mapNodeError()
        }

    /**
     * Unbond [amountAtoms] of matured stake back to the actor derived from
     * [fromSeed].
     */
    suspend fun unbond(fromSeed: ULong, amountAtoms: ULong): Result<SendReceipt> =
        withContext(dispatcher) {
            runCatching { node.unbond(fromSeed, amountAtoms) }.mapNodeError()
        }

    /**
     * Bond [amountAtoms] atoms from the wallet identity derived from a 32-byte
     * Ed25519 secret hex to this node's validator key.
     */
    suspend fun bondStakeFromSecret(secretHex: String, amountAtoms: ULong): Result<String> =
        withContext(dispatcher) {
            runCatching { node.bondStakeFromSecret(secretHex, amountAtoms) }.mapNodeError()
        }

    /**
     * Unbond [amountAtoms] of matured stake back to the wallet address derived
     * from a 32-byte Ed25519 secret hex.
     */
    suspend fun unbondFromSecret(secretHex: String, amountAtoms: ULong): Result<SendReceipt> =
        withContext(dispatcher) {
            runCatching { node.unbondFromSecret(secretHex, amountAtoms) }.mapNodeError()
        }

    /**
     * Set the 32-byte VRF validator seed.
     */
    suspend fun setValidatorSeed(seed: ByteArray): Result<Unit> =
        withContext(dispatcher) {
            runCatching { node.setValidatorSeed(seed) }.mapNodeError()
        }

    /**
     * Enable hybrid admission with sensible v0.1 defaults.
     */
    suspend fun enableHybrid(): Result<Unit> = withContext(dispatcher) {
        runCatching {
            node.enableHybrid(
                rateNum = 1uL,
                rateDen = 100uL,
                nominalWork = U128Parts(high = 0uL, low = 1uL),
                retarget = true,
            )
        }.mapNodeError()
    }

    /**
     * Try to produce a block packing pending transactions; fall back to an
     * empty block if the mempool is empty.
     */
    suspend fun produceBlock(): Result<BlockInfo?> = withContext(dispatcher) {
        runCatching {
            node.produceBlock() ?: node.produceEmptyBlock()
        }.mapNodeError()
    }

    /**
     * Export a single block by lowercase-hex id as a wire-format blob.
     */
    suspend fun exportBlock(blockIdHex: String): Result<ByteArray?> =
        withContext(dispatcher) {
            runCatching { node.exportBlock(blockIdHex) }.mapNodeError()
        }

    /**
     * This validator's bonded stake in atoms.
     */
    suspend fun myStake(): Result<String> =
        withContext(dispatcher) { runCatching { node.myStake().toString() }.mapNodeError() }

    /**
     * Total bonded stake across all validators in atoms.
     */
    suspend fun totalStake(): Result<String> =
        withContext(dispatcher) { runCatching { node.totalStake().toString() }.mapNodeError() }

    /**
     * Earliest height at which bonded stake unlocks next, or null.
     */
    suspend fun pendingUnbondHeight(): Result<String?> =
        withContext(dispatcher) {
            runCatching { node.pendingUnbondHeight()?.toString() }.mapNodeError()
        }

    /**
     * Validator public key hex once a seed has been set.
     */
    suspend fun validatorPublicKeyHex(): Result<String?> =
        withContext(dispatcher) { runCatching { node.validatorPublicKeyHex() }.mapNodeError() }

    fun close() {
        dispatcher.close()
    }

    private fun <T> Result<T>.mapNodeError(): Result<T> =
        fold(
            onSuccess = { Result.success(it) },
            onFailure = {
                Result.failure(
                    IllegalStateException(
                        it.message ?: it.toString(),
                        it,
                    ),
                )
            },
        )

    private data class HeaderInfo(
        val id: String,
        val prevHash: String?,
        val height: Long,
    )

    /**
     * Parse the block ids and heights out of a KVLS v1 light-sync blob.
     * Returns headers in the order they appear in the blob.
     */
    private fun parseLightSyncHeaders(blob: ByteArray): List<HeaderInfo> {
        if (blob.size < 9) return emptyList()
        val magic = "KVLS".toByteArray(Charsets.US_ASCII)
        if (!blob.startsWith(magic) || blob[4] != 1.toByte()) {
            return emptyList()
        }
        val count = ByteBuffer.wrap(blob, 5, 4).order(ByteOrder.BIG_ENDIAN).int
        val out = ArrayList<HeaderInfo>(count)
        var off = 9
        repeat(count) {
            if (blob.size < off + HEADER_SIZE + FILTER_PREFIX_SIZE) return out
            val id = blob.copyOfRange(off, off + 32).toHex()
            val prevHash = blob.copyOfRange(off + 32, off + 64).toHex()
            val height = ByteBuffer.wrap(blob, off + 152, 8).order(ByteOrder.BIG_ENDIAN).long
            out.add(HeaderInfo(id, prevHash, height))
            off += HEADER_SIZE

            // Skip filter: k(1) + n(8) + len(4) + data(len).
            val filterLen = ByteBuffer.wrap(blob, off + 9, 4).order(ByteOrder.BIG_ENDIAN).int
            off += FILTER_PREFIX_SIZE + filterLen
        }
        return out
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean {
        if (size < prefix.size) return false
        for (i in prefix.indices) {
            if (this[i] != prefix[i]) return false
        }
        return true
    }
}

/**
 * Fetch the light-node configuration from a seed node's `GET /api/bootstrap`
 * endpoint. Falls back to [defaultConfig] on any error.
 */
private suspend fun fetchLightConfig(nodeUrl: String): LightConfig = withContext(Dispatchers.IO) {
    val client = OkHttpClient()
    val baseUrl = nodeUrl.trimEnd('/')
    val request = Request.Builder()
        .url("$baseUrl/api/bootstrap")
        .build()

    client.newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
            throw IOException("GET /api/bootstrap failed: HTTP ${response.code}")
        }
        val body = response.body?.string() ?: throw IOException("empty bootstrap response")
        parseLightConfig(JSONObject(body))
    }
}

private fun parseLightConfig(json: JSONObject): LightConfig {
    val lightConfig = json.getJSONObject("light_config")
    return LightConfig(
        k = lightConfig.parseUShort("k"),
        subsidy = lightConfig.parseULong("subsidy"),
        founderAmount = lightConfig.parseULong("premine"),
        founderSeed = lightConfig.parseULong("founder_seed"),
        finalityDepth = lightConfig.parseULong("finality_depth"),
        payloadPruningDepth = lightConfig.parseULong("payload_pruning_depth"),
    )
}

private fun JSONObject.parseULong(name: String): ULong = when (val value = opt(name)) {
    is Number -> value.toLong().toULong()
    is String -> value.toULong()
    else -> throw JSONException("expected number or string for '$name'")
}

private fun JSONObject.parseUShort(name: String): UShort = when (val value = opt(name)) {
    is Number -> value.toInt().toUShort()
    is String -> value.toUShort()
    else -> throw JSONException("expected number or string for '$name'")
}
