package com.kovanica.wallet.data

import com.kovanica.wallet.model.AddressInfo
import com.kovanica.wallet.model.BlockInfo
import com.kovanica.wallet.model.BootstrapInfo
import com.kovanica.wallet.model.FeeEstimate
import com.kovanica.wallet.model.HeadInfo
import com.kovanica.wallet.model.HistoryEntry
import com.kovanica.wallet.model.Utxo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Minimal OkHttp + org.json HTTP client for the Kovanica node REST API.
 * Pure API-backed — no light node, no SPV, no FFI.
 */
class KovApi(
    baseUrlProvider: () -> String,
    private val client: OkHttpClient = defaultClient(),
) {

    private val baseUrl: () -> String = {
        baseUrlProvider().trimEnd('/')
    }

    suspend fun head(): HeadInfo = getJson("api/head") { HeadInfo.fromJson(it) }

    suspend fun bootstrap(): BootstrapInfo = getJson("api/bootstrap") { BootstrapInfo.fromJson(it) }

    suspend fun feeEstimate(): FeeEstimate = getJson("api/fee_estimate") { FeeEstimate.fromJson(it) }

    suspend fun address(addr: String): AddressInfo =
        getJson("api/address/$addr") { AddressInfo.fromJson(it) }

    suspend fun utxos(addr: String, limit: Int = 100): List<Utxo> =
        getJsonArray("api/utxos?address=$addr&limit=$limit") { arr, i ->
            Utxo.fromJson(arr.getJSONObject(i))
        }

    suspend fun history(addr: String, limit: Int, offset: Int): List<HistoryEntry> =
        getJsonArray("api/history?address=$addr&limit=$limit&offset=$offset") { arr, i ->
            HistoryEntry.fromJson(arr.getJSONObject(i))
        }

    suspend fun blocks(from: String): List<BlockInfo> =
        getJsonArray("api/blocks?from=$from") { arr, i ->
            BlockInfo.fromJson(arr.getJSONObject(i))
        }

    suspend fun faucet(address: String): JSONObject =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("address", address)
                .toString()
                .toRequestBody(JSON_MEDIA_TYPE)
            val request = Request.Builder()
                .url("${baseUrl()}/api/faucet")
                .post(body)
                .build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw IOException("faucet HTTP ${resp.code}")
                JSONObject(resp.body?.string().orEmpty())
            }
        }

    private suspend fun <T> getJson(path: String, parse: (JSONObject) -> T): T =
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url("${baseUrl()}/$path").get().build()
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) throw IOException("$path HTTP ${resp.code}")
                parse(JSONObject(resp.body?.string().orEmpty()))
            }
        }

    private suspend fun <T> getJsonArray(
        path: String,
        parse: (JSONArray, Int) -> T,
    ): List<T> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${baseUrl()}/$path").get().build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("$path HTTP ${resp.code}")
            val arr = JSONArray(resp.body?.string().orEmpty())
            val result = mutableListOf<T>()
            for (i in 0 until arr.length()) {
                result.add(parse(arr, i))
            }
            result
        }
    }

    companion object {
        const val KOVANICA_API_DEFAULT = "https://explorer.kovanica.online"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
