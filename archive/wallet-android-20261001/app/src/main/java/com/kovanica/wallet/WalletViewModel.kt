package com.kovanica.wallet

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.map
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * WalletViewModel - Exposes WalletManager to UI layer with proper lifecycle handling.
 */
class WalletViewModel(application: Application) : AndroidViewModel(application) {

    private val walletManager = WalletManager.initialize(application, "testnet")

    // ==================== EXPOSED STATE ====================

    val syncState: LiveData<LightSyncState> = walletManager.syncState
    val balance: LiveData<BalanceInfo> = walletManager.balance
    val peers: LiveData<List<PeerInfo>> = walletManager.peers
    val height: LiveData<Long> = walletManager.height
    val tips: LiveData<List<String>> = walletManager.tips
    val transactions: LiveData<List<TransactionInfo>> = walletManager.transactions
    val utxos: LiveData<List<UtxoInfo>> = walletManager.utxos
    val stakes: LiveData<List<StakeInfo>> = walletManager.stakes

    // Derived state
    val nativeBalanceKvnc: LiveData<Double> = balance.map { it.nativeKvnc }
    val totalBalanceKvnc: LiveData<Double> = balance.map { it.totalValueKvnc }
    val isSyncing: LiveData<Boolean> = syncState.map { it != LightSyncState.SYNCED }
    val peerCount: LiveData<Int> = peers.map { it.size }

    // ==================== SYNC OPERATIONS ====================

    fun startFullSync() {
        walletManager.startFullSync()
    }

    fun startLightSync() {
        walletManager.startLightSync()
    }

    fun exportBlocks(fromHeight: Long, toHeight: Long, onResult: (String) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = walletManager.exportBlocks(fromHeight, toHeight)
            onResult(result)
        }
    }

    fun receiveBlocks(blocksHex: String, onResult: (Boolean) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = walletManager.receiveBlocks(blocksHex)
            onResult(result)
        }
    }

    // ==================== QUERY OPERATIONS ====================

    fun refreshAll() {
        walletManager.refreshAll()
    }

    fun getAssetBalance(assetId: String, onResult: (Long) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = walletManager.getAssetBalance(assetId)
            onResult(result)
        }
    }

    fun getTransaction(txId: String, onResult: (TransactionInfo?) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = walletManager.getTransaction(txId)
            onResult(result)
        }
    }

    // ==================== TRANSFER OPERATIONS ====================

    fun sendNative(
        fromAddress: String,
        toAddress: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.sendNative(fromAddress, toAddress, amountAtoms, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun sendAsset(
        fromAddress: String,
        toAddress: String,
        assetId: String,
        amount: Long,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.sendAsset(fromAddress, toAddress, assetId, amount, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun sendToScript(
        fromAddress: String,
        script: LightScript,
        amountAtoms: Long,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.sendToScript(fromAddress, script, amountAtoms, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun sendToStealth(
        fromAddress: String,
        stealthAddress: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.sendToStealth(fromAddress, stealthAddress, amountAtoms, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun estimateFee(
        fromAddress: String,
        toAddress: String,
        amountAtoms: Long,
        onResult: (Long) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            val fee = walletManager.estimateFee(fromAddress, toAddress, amountAtoms)
            onResult(fee)
        }
    }

    // ==================== MULTISIG OPERATIONS ====================

    fun createMultisigScript(
        pubkeys: List<String>,
        threshold: Int,
        onResult: (LightScript) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            val script = walletManager.createMultisigScript(pubkeys, threshold)
            onResult(script)
        }
    }

    fun signMultisig(
        txHex: String,
        privateKeyHex: String,
        script: LightScript,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val signature = walletManager.signMultisig(txHex, privateKeyHex, script)
                onResult(Result.success(signature))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun combineMultisigSignatures(
        txHex: String,
        signatures: List<String>,
        script: LightScript,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val combinedTx = walletManager.combineMultisigSignatures(txHex, signatures, script)
                onResult(Result.success(combinedTx))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    // ==================== HTLC OPERATIONS ====================

    fun createHtlcScript(
        senderPubkey: String,
        receiverPubkey: String,
        hashlock: String,
        timelock: Long,
        assetId: String? = null,
        onResult: (LightScript) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            val script = walletManager.createHtlcScript(senderPubkey, receiverPubkey, hashlock, timelock, assetId)
            onResult(script)
        }
    }

    fun spendHtlc(
        fromAddress: String,
        script: LightScript,
        preimage: String,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.spendHtlc(fromAddress, script, preimage, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun refundHtlc(
        fromAddress: String,
        script: LightScript,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.refundHtlc(fromAddress, script, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    // ==================== VAULT OPERATIONS ====================

    fun createVaultScript(
        pubkey: String,
        lockHeight: Long,
        assetId: String? = null,
        onResult: (LightScript) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            val script = walletManager.createVaultScript(pubkey, lockHeight, assetId)
            onResult(script)
        }
    }

    fun spendVault(
        fromAddress: String,
        script: LightScript,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.spendVault(fromAddress, script, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    // ==================== STAKING OPERATIONS ====================

    fun stake(
        fromAddress: String,
        validatorPubkey: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.stake(fromAddress, validatorPubkey, amountAtoms, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun unstake(
        fromAddress: String,
        validatorPubkey: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.unstake(fromAddress, validatorPubkey, amountAtoms, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun claimRewards(
        fromAddress: String,
        validatorPubkey: String,
        feeAtoms: Long = 100000,
        onResult: (Result<String>) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val txId = walletManager.claimRewards(fromAddress, validatorPubkey, feeAtoms)
                onResult(Result.success(txId))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    // ==================== PERSISTENCE ====================

    fun exportWallet(password: String, onResult: (Result<String>) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val backup = walletManager.exportWallet(password)
                onResult(Result.success(backup))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    fun importWallet(backupHex: String, password: String, onResult: (Boolean) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = walletManager.importWallet(backupHex, password)
            onResult(result)
        }
    }

    // ==================== ADDRESS MANAGEMENT ====================

    fun generateAddress(onResult: (String) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val address = walletManager.generateAddress()
            onResult(address)
        }
    }

    fun getAddresses(onResult: (List<String>) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val addresses = walletManager.getAddresses()
            onResult(addresses)
        }
    }

    fun importAddress(privateKeyHex: String, onResult: (String) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val address = walletManager.importAddress(privateKeyHex)
            onResult(address)
        }
    }

    fun importFromMnemonic(mnemonic: String, passphrase: String = "", onResult: (String) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val address = walletManager.importFromMnemonic(mnemonic, passphrase)
            onResult(address)
        }
    }

    // ==================== NETWORK INFO ====================

    fun getNetworkInfo(onResult: (NetworkInfo) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            val info = walletManager.getNetworkInfo()
            onResult(info)
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Don't destroy wallet manager here - it's a singleton
        // WalletManager.destroy() // Only call on app termination
    }
}