package com.kovanica.wallet

import android.content.Context
import android.util.Log
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.kovanica.ffi.LightNode
import com.kovanica.ffi.LightConfig
import com.kovanica.ffi.LightBalance
import com.kovanica.ffi.LightUtxo
import com.kovanica.ffi.LightTx
import com.kovanica.ffi.LightScript
import com.kovanica.ffi.LightStake
import com.kovanica.ffi.LightAmount
import com.kovanica.ffi.LightPeerInfo
import com.kovanica.ffi.LightSyncState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * WalletManager - Repository layer wrapping the Kovanica LightNode FFI.
 * Handles all blockchain operations: sync, balances, transactions, multisig, HTLC, vaults, staking.
 */
class WalletManager private constructor(
    private val context: Context,
    private val lightNode: LightNode
) {

    companion object {
        private const val TAG = "WalletManager"
        private var INSTANCE: WalletManager? = null
        private val initialized = AtomicBoolean(false)

        /**
         * Initialize the wallet manager with genesis configuration.
         * Must be called once at application startup.
         */
        @Synchronized
        fun initialize(
            context: Context,
            network: String = "testnet",
            dataDir: String? = null
        ): WalletManager {
            if (initialized.getAndSet(true)) {
                return INSTANCE!!
            }

            val config = when (network) {
                "mainnet" -> LightConfig.mainnet()
                "testnet" -> LightConfig.testnet()
                "devnet" -> LightConfig.devnet()
                else -> LightConfig.testnet()
            }

            // Override data directory if provided
            val workingDir = dataDir ?: File(context.filesDir, "kovanica_data").absolutePath
            config.setDataDir(workingDir)

            val node = LightNode.create(config)
            val manager = WalletManager(context, node)
            INSTANCE = manager
            Log.i(TAG, "WalletManager initialized for $network at $workingDir")
            return manager
        }

        @Synchronized
        fun getInstance(): WalletManager? = INSTANCE

        @Synchronized
        fun destroy() {
            INSTANCE?.lightNode?.destroy()
            INSTANCE = null
            initialized.set(false)
        }
    }

    // ==================== STATE ====================

    private val _syncState = MutableLiveData<LightSyncState>()
    val syncState: LiveData<LightSyncState> = _syncState

    private val _balance = MutableLiveData<BalanceInfo>()
    val balance: LiveData<BalanceInfo> = _balance

    private val _peers = MutableLiveData<List<PeerInfo>>()
    val peers: LiveData<List<PeerInfo>> = _peers

    private val _height = MutableLiveData<Long>()
    val height: LiveData<Long> = _height

    private val _tips = MutableLiveData<List<String>>()
    val tips: LiveData<List<String>> = _tips

    private val _transactions = MutableLiveData<List<TransactionInfo>>()
    val transactions: LiveData<List<TransactionInfo>> = _transactions

    private val _utxos = MutableLiveData<List<UtxoInfo>>()
    val utxos: LiveData<List<UtxoInfo>> = _utxos

    private val _stakes = MutableLiveData<List<StakeInfo>>()
    val stakes: LiveData<StakeInfo> = _stakes

    // ==================== SYNC OPERATIONS ====================

    /**
     * Start full sync from genesis.
     */
    fun startFullSync() = viewModelScope.launch(Dispatchers.IO) {
        try {
            lightNode.startFullSync()
            observeSync()
        } catch (e: Exception) {
            Log.e(TAG, "Full sync failed", e)
        }
    }

    /**
     * Start light sync (headers only, faster).
     */
    fun startLightSync() = viewModelScope.launch(Dispatchers.IO) {
        try {
            lightNode.startLightSync()
            observeSync()
        } catch (e: Exception) {
            Log.e(TAG, "Light sync failed", e)
        }
    }

    /**
     * Export blocks for offline sync (returns hex-encoded block data).
     */
    suspend fun exportBlocks(fromHeight: Long, toHeight: Long): String = withContext(Dispatchers.IO) {
        lightNode.exportBlocks(fromHeight, toHeight)
    }

    /**
     * Receive blocks from offline sync (hex-encoded block data).
     */
    suspend fun receiveBlocks(blocksHex: String): Boolean = withContext(Dispatchers.IO) {
        lightNode.receiveBlocks(blocksHex)
    }

    /**
     * Export light sync data (headers only).
     */
    suspend fun exportLightSync(fromHeight: Long, toHeight: Long): String = withContext(Dispatchers.IO) {
        lightNode.exportLightSync(fromHeight, toHeight)
    }

    /**
     * Receive light sync data.
     */
    suspend fun receiveLightSync(syncDataHex: String): Boolean = withContext(Dispatchers.IO) {
        lightNode.receiveLightSync(syncDataHex)
    }

    /**
     * Observe sync state changes.
     */
    private fun observeSync() = viewModelScope.launch(Dispatchers.IO) {
        while (true) {
            val state = lightNode.getSyncState()
            _syncState.postValue(state)
            if (state == LightSyncState.SYNCED) break
            Thread.sleep(1000)
        }
        // Refresh all data after sync
        refreshAll()
    }

    // ==================== QUERY OPERATIONS ====================

    /**
     * Refresh all wallet data.
     */
    fun refreshAll() = viewModelScope.launch(Dispatchers.IO) {
        refreshBalance()
        refreshHeight()
        refreshTips()
        refreshPeers()
        refreshTransactions()
        refreshUtxos()
        refreshStakes()
    }

    suspend fun refreshBalance() = withContext(Dispatchers.IO) {
        val nativeBalance = lightNode.getBalance()
        val assetBalances = lightNode.getAllAssetBalances()
        _balance.postValue(BalanceInfo(nativeBalance, assetBalances))
    }

    suspend fun refreshHeight() = withContext(Dispatchers.IO) {
        _height.postValue(lightNode.getHeight())
    }

    suspend fun refreshTips() = withContext(Dispatchers.IO) {
        _tips.postValue(lightNode.getTips())
    }

    suspend fun refreshPeers() = withContext(Dispatchers.IO) {
        _peers.postValue(lightNode.getPeers().map { PeerInfo(it) })
    }

    suspend fun refreshTransactions() = withContext(Dispatchers.IO) {
        _transactions.postValue(lightNode.getHistory().map { TransactionInfo(it) })
    }

    suspend fun refreshUtxos() = withContext(Dispatchers.IO) {
        _utxos.postValue(lightNode.getUtxos().map { UtxoInfo(it) })
    }

    suspend fun refreshStakes() = withContext(Dispatchers.IO) {
        _stakes.postValue(lightNode.getStakes().map { StakeInfo(it) })
    }

    /**
     * Get balance for a specific asset.
     */
    suspend fun getAssetBalance(assetId: String): Long = withContext(Dispatchers.IO) {
        lightNode.getAssetBalance(assetId)
    }

    /**
     * Get UTXOs for a specific asset.
     */
    suspend fun getAssetUtxos(assetId: String): List<UtxoInfo> = withContext(Dispatchers.IO) {
        lightNode.getAssetUtxos(assetId).map { UtxoInfo(it) }
    }

    /**
     * Get transaction by ID.
     */
    suspend fun getTransaction(txId: String): TransactionInfo? = withContext(Dispatchers.IO) {
        lightNode.getTransaction(txId)?.let { TransactionInfo(it) }
    }

    // ==================== TRANSFER OPERATIONS ====================

    /**
     * Send native KVNC from a specific address.
     */
    suspend fun sendNative(
        fromAddress: String,
        toAddress: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000 // 0.001 KVNC default fee
    ): String = withContext(Dispatchers.IO) {
        lightNode.sendFrom(fromAddress, toAddress, amountAtoms, feeAtoms)
    }

    /**
     * Send asset tokens from a specific address.
     */
    suspend fun sendAsset(
        fromAddress: String,
        toAddress: String,
        assetId: String,
        amount: Long,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.sendFromAsset(fromAddress, toAddress, assetId, amount, feeAtoms)
    }

    /**
     * Send to a script (multisig, HTLC, vault, etc.)
     */
    suspend fun sendToScript(
        fromAddress: String,
        script: LightScript,
        amountAtoms: Long,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.sendToScriptV2(fromAddress, script, amountAtoms, feeAtoms)
    }

    /**
     * Send to stealth address.
     */
    suspend fun sendToStealth(
        fromAddress: String,
        stealthAddress: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.sendToStealth(fromAddress, stealthAddress, amountAtoms, feeAtoms)
    }

    /**
     * Estimate fee for a transaction.
     */
    suspend fun estimateFee(
        fromAddress: String,
        toAddress: String,
        amountAtoms: Long
    ): Long = withContext(Dispatchers.IO) {
        lightNode.estimateFee(fromAddress, toAddress, amountAtoms)
    }

    // ==================== MULTISIG OPERATIONS ====================

    /**
     * Create a multisig script (M-of-N).
     */
    suspend fun createMultisigScript(
        pubkeys: List<String>,
        threshold: Int
    ): LightScript = withContext(Dispatchers.IO) {
        lightNode.createMultisigScript(pubkeys.toTypedArray(), threshold)
    }

    /**
     * Sign a multisig transaction (partial signature).
     */
    suspend fun signMultisig(
        txHex: String,
        privateKeyHex: String,
        script: LightScript
    ): String = withContext(Dispatchers.IO) {
        lightNode.signMultisig(txHex, privateKeyHex, script)
    }

    /**
     * Combine partial multisig signatures.
     */
    suspend fun combineMultisigSignatures(
        txHex: String,
        signatures: List<String>,
        script: LightScript
    ): String = withContext(Dispatchers.IO) {
        lightNode.combineMultisigSignatures(txHex, signatures.toTypedArray(), script)
    }

    // ==================== HTLC OPERATIONS ====================

    /**
     * Create an HTLC script.
     * @param senderPubkey Sender's public key (hex)
     * @param receiverPubkey Receiver's public key (hex)
     * @param hashlock Hashlock (hex-encoded hash)
     * @param timelock Block height timelock
     * @param assetId Optional asset ID (null for native KVNC)
     */
    suspend fun createHtlcScript(
        senderPubkey: String,
        receiverPubkey: String,
        hashlock: String,
        timelock: Long,
        assetId: String? = null
    ): LightScript = withContext(Dispatchers.IO) {
        lightNode.createHtlcScript(senderPubkey, receiverPubkey, hashlock, timelock, assetId)
    }

    /**
     * Spend an HTLC with preimage.
     */
    suspend fun spendHtlc(
        fromAddress: String,
        script: LightScript,
        preimage: String,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.spendHtlc(fromAddress, script, preimage, feeAtoms)
    }

    /**
     * Refund an HTLC after timelock expiry.
     */
    suspend fun refundHtlc(
        fromAddress: String,
        script: LightScript,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.refundHtlc(fromAddress, script, feeAtoms)
    }

    // ==================== VAULT OPERATIONS (RFC-005) ====================

    /**
     * Create a time-lock vault script.
     */
    suspend fun createVaultScript(
        pubkey: String,
        lockHeight: Long,
        assetId: String? = null
    ): LightScript = withContext(Dispatchers.IO) {
        lightNode.createVaultScript(pubkey, lockHeight, assetId)
    }

    /**
     * Spend from a mature vault.
     */
    suspend fun spendVault(
        fromAddress: String,
        script: LightScript,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.spendVault(fromAddress, script, feeAtoms)
    }

    // ==================== STAKING OPERATIONS ====================

    /**
     * Create a staking transaction (delegate to validator).
     */
    suspend fun stake(
        fromAddress: String,
        validatorPubkey: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.stake(fromAddress, validatorPubkey, amountAtoms, feeAtoms)
    }

    /**
     * Unstake (undelegate from validator).
     */
    suspend fun unstake(
        fromAddress: String,
        validatorPubkey: String,
        amountAtoms: Long,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.unstake(fromAddress, validatorPubkey, amountAtoms, feeAtoms)
    }

    /**
     * Claim staking rewards.
     */
    suspend fun claimRewards(
        fromAddress: String,
        validatorPubkey: String,
        feeAtoms: Long = 100000
    ): String = withContext(Dispatchers.IO) {
        lightNode.claimRewards(fromAddress, validatorPubkey, feeAtoms)
    }

    // ==================== PERSISTENCE ====================

    /**
     * Export wallet state (encrypted backup).
     */
    suspend fun exportWallet(password: String): String = withContext(Dispatchers.IO) {
        lightNode.exportWallet(password)
    }

    /**
     * Import wallet state from backup.
     */
    suspend fun importWallet(backupHex: String, password: String): Boolean = withContext(Dispatchers.IO) {
        lightNode.importWallet(backupHex, password)
    }

    /**
     * Export private key for an address (DANGEROUS - use with caution).
     */
    suspend fun exportPrivateKey(address: String, password: String): String = withContext(Dispatchers.IO) {
        lightNode.exportPrivateKey(address, password)
    }

    // ==================== ADDRESS MANAGEMENT ====================

    /**
     * Generate a new address.
     */
    suspend fun generateAddress(): String = withContext(Dispatchers.IO) {
        lightNode.generateAddress()
    }

    /**
     * Get all addresses in wallet.
     */
    suspend fun getAddresses(): List<String> = withContext(Dispatchers.IO) {
        lightNode.getAddresses()
    }

    /**
     * Import address from private key.
     */
    suspend fun importAddress(privateKeyHex: String): String = withContext(Dispatchers.IO) {
        lightNode.importAddress(privateKeyHex)
    }

    /**
     * Import address from mnemonic seed phrase.
     */
    suspend fun importFromMnemonic(mnemonic: String, passphrase: String = ""): String = withContext(Dispatchers.IO) {
        lightNode.importFromMnemonic(mnemonic, passphrase)
    }

    // ==================== NETWORK INFO ====================

    suspend fun getNetworkInfo(): NetworkInfo = withContext(Dispatchers.IO) {
        NetworkInfo(
            height = lightNode.getHeight(),
            tips = lightNode.getTips(),
            peers = lightNode.getPeers().map { PeerInfo(it) },
            syncState = lightNode.getSyncState()
        )
    }

    // ==================== CLEANUP ====================

    fun shutdown() {
        lightNode.destroy()
    }
}

// ==================== DATA CLASSES ====================

data class BalanceInfo(
    val nativeBalance: Long, // in atoms
    val assetBalances: Map<String, Long> // assetId -> amount
) {
    val nativeKvnc: Double get() = nativeBalance / 100_000_000.0
    val totalValueKvnc: Double get() = nativeKvnc + assetBalances.values.sum() / 100_000_000.0
}

data class UtxoInfo(
    val txId: String,
    val index: Int,
    val address: String,
    val amount: Long,
    val assetId: String?, // null = native KVNC
    val height: Long,
    val isCoinbase: Boolean,
    val isMature: Boolean,
    val scriptType: String
) {
    constructor(utxo: LightUtxo) : this(
        txId = utxo.txId,
        index = utxo.index,
        address = utxo.address,
        amount = utxo.amount,
        assetId = utxo.assetId,
        height = utxo.height,
        isCoinbase = utxo.isCoinbase,
        isMature = utxo.isMature,
        scriptType = utxo.scriptType
    )

    val amountKvnc: Double get() = amount / 100_000_000.0
}

data class TransactionInfo(
    val txId: String,
    val height: Long,
    val timestamp: Long,
    val inputs: List<TransactionInput>,
    val outputs: List<TransactionOutput>,
    val fee: Long,
    val isCoinbase: Boolean,
    val status: String // "pending", "confirmed", "failed"
) {
    constructor(tx: LightTx) : this(
        txId = tx.txId,
        height = tx.height,
        timestamp = tx.timestamp,
        inputs = tx.inputs.map { TransactionInput(it) },
        outputs = tx.outputs.map { TransactionOutput(it) },
        fee = tx.fee,
        isCoinbase = tx.isCoinbase,
        status = tx.status
    )

    val feeKvnc: Double get() = fee / 100_000_000.0
}

data class TransactionInput(
    val txId: String,
    val index: Int,
    val address: String,
    val amount: Long,
    val assetId: String?
) {
    constructor(input: com.kovanica.ffi.LightTxInput) : this(
        txId = input.txId,
        index = input.index,
        address = input.address,
        amount = input.amount,
        assetId = input.assetId
    )
}

data class TransactionOutput(
    val address: String,
    val amount: Long,
    val assetId: String?,
    val scriptType: String
) {
    constructor(output: com.kovanica.ffi.LightTxOutput) : this(
        address = output.address,
        amount = output.amount,
        assetId = output.assetId,
        scriptType = output.scriptType
    )

    val amountKvnc: Double get() = amount / 100_000_000.0
}

data class PeerInfo(
    val address: String,
    val version: String,
    val height: Long,
    val isConnected: Boolean,
    val latencyMs: Long
) {
    constructor(peer: LightPeerInfo) : this(
        address = peer.address,
        version = peer.version,
        height = peer.height,
        isConnected = peer.isConnected,
        latencyMs = peer.latencyMs
    )
}

data class StakeInfo(
    val validatorPubkey: String,
    val amount: Long,
    val rewards: Long,
    val status: String // "active", "unbonding", "inactive"
) {
    constructor(stake: LightStake) : this(
        validatorPubkey = stake.validatorPubkey,
        amount = stake.amount,
        rewards = stake.rewards,
        status = stake.status
    )

    val amountKvnc: Double get() = amount / 100_000_000.0
    val rewardsKvnc: Double get() = rewards / 100_000_000.0
}

data class NetworkInfo(
    val height: Long,
    val tips: List<String>,
    val peers: List<PeerInfo>,
    val syncState: LightSyncState
)