package com.kovanica.wallet.data

import android.util.Log
import uniffi.kovanica.LightNode
import uniffi.kovanica.LightConfig
import uniffi.kovanica.HistoryEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Thin wrapper around the UniFFI LightNode for the mobile app.
 *
 * All blockchain operations go through here so the UI never touches
 * the FFI layer directly. Errors are mapped to a sealed result type
 * the ViewModel can render.
 */
class WalletRepository(private val node: LightNode) {

    companion object {
        private const val TAG = "WalletRepository"
    }

    // ── Balance ──────────────────────────────────────────────────────

    suspend fun getBalance(address: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching { node.balanceOfAddress(address) }
    }

    suspend fun getBalanceForAsset(address: String, assetIdHex: String?): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching { node.balanceOfAsset(address, assetIdHex) }
        }

    // ── Transfers ────────────────────────────────────────────────────

    suspend fun send(
        signingKey: String,
        amount: ULong,
        toAddress: String
    ): Result<SendResult> = withContext(Dispatchers.IO) {
        runCatching {
            val receipt = node.sendFrom(signingKey, amount, toAddress)
            SendResult(
                blockIdHex = receipt.blockIdHex,
                txIdHex = receipt.txIdHex
            )
        }
    }

    suspend fun sendAsset(
        signingKey: String,
        amount: ULong,
        toAddress: String,
        assetIdHex: String?
    ): Result<SendResult> = withContext(Dispatchers.IO) {
        runCatching {
            val receipt = node.sendFromAsset(signingKey, amount, toAddress, assetIdHex)
            SendResult(
                blockIdHex = receipt.blockIdHex,
                txIdHex = receipt.txIdHex
            )
        }
    }

    // ── Sync ─────────────────────────────────────────────────────────

    suspend fun exportBlocks(): Result<ByteArray> = withContext(Dispatchers.IO) {
        runCatching { node.exportBlocks() }
    }

    suspend fun receiveBlocks(blob: ByteArray): Result<Int> = withContext(Dispatchers.IO) {
        runCatching { node.receiveBlocks(blob).toInt() }
    }

    suspend fun exportLightSync(): Result<ByteArray> = withContext(Dispatchers.IO) {
        runCatching { node.exportLightSync() }
    }

    suspend fun receiveLightSync(blob: ByteArray): Result<Int> = withContext(Dispatchers.IO) {
        runCatching { node.receiveLightSync(blob).toInt() }
    }

    // ── Queries ──────────────────────────────────────────────────────

    suspend fun chainHeight(): Result<Long> = withContext(Dispatchers.IO) {
        runCatching { node.chainHeight().toLong() }
    }

    suspend fun blockCount(): Result<UInt> = withContext(Dispatchers.IO) {
        runCatching { node.blockCount() }
    }

    suspend fun selectedTip(): Result<String> = withContext(Dispatchers.IO) {
        runCatching { node.selectedTip() }
    }

    suspend fun historyOf(address: String, maxBlocks: Int): Result<List<HistoryEntry>> =
        withContext(Dispatchers.IO) {
            runCatching { node.historyOf(address, maxBlocks.toUInt()) }
        }

    // ── Multisig ─────────────────────────────────────────────────────

    suspend fun createMultisigAddress(
        threshold: UByte,
        pubkeys: List<String>
    ): Result<MultisigAddressResult> = withContext(Dispatchers.IO) {
        runCatching {
            val result = node.createMultisigAddress(threshold, pubkeys)
            MultisigAddressResult(
                address = result.address,
                redeemScriptHex = result.redeemScriptHex
            )
        }
    }

    // ── HTLC ─────────────────────────────────────────────────────────

    suspend fun createHtlc(
        signingKey: String,
        amount: ULong,
        assetIdHex: String?,
        recipientPk: String,
        preimageHash: String,
        timeout: UInt
    ): Result<HtlcInfoResult> = withContext(Dispatchers.IO) {
        runCatching {
            val info = node.createHtlc(
                signingKey, amount, assetIdHex,
                recipientPk, preimageHash, timeout
            )
            HtlcInfoResult(
                scriptHex = info.scriptHex,
                address = info.address,
                txId = info.txId,
                outpointTx = info.outpointTx,
                outpointIndex = info.outpointIndex
            )
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────────

    suspend fun saveSnapshot(path: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching { node.saveSnapshot(path) }
    }

    suspend fun loadSnapshot(path: String, config: LightConfig): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching { node.loadSnapshot(path, config) }
        }
}

// ── Result data classes ──────────────────────────────────────────────

data class SendResult(
    val blockIdHex: String,
    val txIdHex: String
)

data class MultisigAddressResult(
    val address: String,
    val redeemScriptHex: String
)

data class HtlcInfoResult(
    val scriptHex: String,
    val address: String,
    val txId: String,
    val outpointTx: String,
    val outpointIndex: UInt
)