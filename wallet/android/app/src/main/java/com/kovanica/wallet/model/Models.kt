package com.kovanica.wallet.model

import org.json.JSONArray
import org.json.JSONObject

const val KVNC_DECIMALS = 8
const val ATOM: Long = 100_000_000L

const val KVNC_SYMBOL = "KVNC"
const val KVNC_TOKEN_NAME = "Kovanica (KVNC)"

data class HeadInfo(
    val network: String,
    val genesis: String,
    val tip: String,
    val blocks: Long,
    val minFee: Long,
    val atom: Long,
) {
    companion object {
        fun fromJson(json: JSONObject) = HeadInfo(
            network = json.optString("network"),
            genesis = json.optString("genesis"),
            tip = json.optString("tip"),
            blocks = json.optLong("blocks"),
            minFee = json.optLong("min_fee"),
            atom = json.optLong("atom"),
        )
    }
}

data class BootstrapInfo(
    val network: String,
    val genesis: String,
    val tip: String,
    val pow: Boolean,
    val minFee: Long,
    val atom: Long,
    val token: String,
    val k: Int,
    val subsidy: Long,
    val founderAmount: Long,
    val founderSeed: Long,
    val finalityDepth: Int,
    val payloadPruningDepth: Int,
) {
    companion object {
        fun fromJson(json: JSONObject) = BootstrapInfo(
            network = json.optString("network"),
            genesis = json.optString("genesis"),
            tip = json.optString("tip"),
            pow = json.optBoolean("pow"),
            minFee = json.optLong("min_fee"),
            atom = json.optLong("atom"),
            token = json.optString("token"),
            k = json.optInt("k"),
            subsidy = json.optLong("subsidy"),
            founderAmount = json.optLong("founder_amount"),
            founderSeed = json.optLong("founder_seed"),
            finalityDepth = json.optInt("finality_depth"),
            payloadPruningDepth = json.optInt("payload_pruning_depth"),
        )
    }
}

data class FeeEstimate(
    val feeRate: Long,
    val unit: String,
    val mempool: Long,
    val bytes: Long,
) {
    companion object {
        fun fromJson(json: JSONObject) = FeeEstimate(
            feeRate = json.optLong("fee_rate"),
            unit = json.optString("unit"),
            mempool = json.optLong("mempool"),
            bytes = json.optLong("bytes"),
        )
    }
}

data class AddressInfo(
    val address: String,
    val balance: Long,
    val txCount: Long,
) {
    companion object {
        fun fromJson(json: JSONObject) = AddressInfo(
            address = json.optString("address"),
            balance = json.optLong("balance"),
            txCount = json.optLong("tx_count"),
        )
    }
}

data class Utxo(
    val tx: String,
    val index: Int,
    val amount: Long,
    val lock: String?,
) {
    companion object {
        fun fromJson(json: JSONObject) = Utxo(
            tx = json.optString("tx"),
            index = json.optInt("index"),
            amount = json.optLong("amount"),
            lock = json.optString("lock").ifBlank { null },
        )
    }
}

enum class HistoryKind {
    IN,
    OUT,
    FAUCET,
    COINBASE,
    UNKNOWN;

    companion object {
        fun fromString(value: String): HistoryKind = when (value.lowercase()) {
            "in" -> IN
            "out" -> OUT
            "faucet" -> FAUCET
            "coinbase" -> COINBASE
            else -> UNKNOWN
        }
    }
}

data class HistoryEntry(
    val block: String,
    val tx: String,
    val kind: HistoryKind,
    val amount: Long,
    val from: String,
    val to: String,
    val height: Long,
) {
    companion object {
        fun fromJson(json: JSONObject) = HistoryEntry(
            block = json.optString("block"),
            tx = json.optString("tx"),
            kind = HistoryKind.fromString(json.optString("kind")),
            amount = json.optLong("amount"),
            from = json.optString("from"),
            to = json.optString("to"),
            height = json.optLong("height"),
        )

        fun list(json: JSONArray): List<HistoryEntry> {
            val result = mutableListOf<HistoryEntry>()
            for (i in 0 until json.length()) {
                result.add(fromJson(json.getJSONObject(i)))
            }
            return result
        }
    }
}

data class BlockInfo(
    val id: String,
    val height: Long,
    val pow: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject) = BlockInfo(
            id = json.optString("id"),
            height = json.optLong("height"),
            pow = json.optBoolean("pow"),
        )
    }
}
