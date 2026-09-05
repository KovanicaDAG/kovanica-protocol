package com.kovanica.lightnode.data

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * HTTP client for the Kovanica full node. All methods are suspending, run on
 * [Dispatchers.IO], and return a [Result] so the repository layer can stay
 * exception-free.
 */
class NodeClient(private val nodeUrl: NodeUrl) {

    private val client: OkHttpClient = OkHttpClient()

    /**
     * Fetch a KVLS v1 light-sync blob starting strictly after [from]
     * (or from genesis if null).
     */
    suspend fun fetchLightSync(from: String?): Result<ByteArray> = withContext(Dispatchers.IO) {
        runCatching {
            val url = buildUrl(nodeUrl.apiPath("/api/light_sync"), from?.let { "from" to it })
            getBytes(url)
        }.mapHttpError()
    }

    /**
     * Fetch full block records starting strictly after [from]
     * (or from genesis if null).
     */
    suspend fun fetchBlocks(from: String?): Result<ByteArray> = withContext(Dispatchers.IO) {
        runCatching {
            val url = buildUrl(nodeUrl.apiPath("/api/blocks"), from?.let { "from" to it })
            getBytes(url)
        }.mapHttpError()
    }

    /**
     * Fetch paginated on-chain history for [address].
     */
    suspend fun fetchHistory(
        address: String,
        limit: Int,
        offset: Int,
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val params = listOf(
                "address" to address,
                "limit" to limit.toString(),
                "offset" to offset.toString(),
            )
            getText(buildUrl(nodeUrl.apiPath("/api/history"), params))
        }.mapHttpError()
    }

    /**
     * Fetch paginated UTXOs for [address].
     */
    suspend fun fetchUtxos(
        address: String,
        limit: Int,
        offset: Int,
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val params = listOf(
                "address" to address,
                "limit" to limit.toString(),
                "offset" to offset.toString(),
            )
            getText(buildUrl(nodeUrl.apiPath("/api/utxos"), params))
        }.mapHttpError()
    }

    /**
     * Submit a raw block record blob to the node's mining/uplink endpoint.
     * Returns the server's JSON response on HTTP 200.
     */
    suspend fun submitBlock(bytes: ByteArray): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url(nodeUrl.apiPath("/api/mine/submit"))
                .post(bytes.toRequestBody(OCTET_STREAM))
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("submitBlock failed: HTTP ${response.code}")
                }
                response.body?.string() ?: "{\"ok\":true}"
            }
        }.mapHttpError()
    }

    /**
     * Request testnet KVNC from the faucet for [address].
     */
    suspend fun requestFaucet(address: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val body = "{\"address\":\"$address\"}".toRequestBody(JSON)
            val request = Request.Builder()
                .url(nodeUrl.apiPath("/api/faucet"))
                .post(body)
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("faucet request failed: HTTP ${response.code}")
                }
                response.body?.string() ?: "{}"
            }
        }.mapHttpError()
    }

    private fun getBytes(url: String): ByteArray {
        val request = Request.Builder().url(url).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("GET $url failed: HTTP ${response.code}")
            }
            return response.body?.bytes()
                ?: throw IOException("empty response from $url")
        }
    }

    private fun getText(url: String): String {
        val request = Request.Builder().url(url).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("GET $url failed: HTTP ${response.code}")
            }
            return response.body?.string()
                ?: throw IOException("empty response from $url")
        }
    }

    private fun buildUrl(path: String, query: Pair<String, String>?): String {
        return if (query == null) {
            path
        } else {
            "$path?${query.first}=${query.second}"
        }
    }

    private fun buildUrl(path: String, query: List<Pair<String, String>>): String {
        return if (query.isEmpty()) {
            path
        } else {
            val qs = query.joinToString("&") { "${it.first}=${it.second}" }
            "$path?$qs"
        }
    }

    private fun <T> Result<T>.mapHttpError(): Result<T> =
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

    companion object {
        private val OCTET_STREAM = "application/octet-stream".toMediaType()
        private val JSON = "application/json".toMediaType()
    }
}
