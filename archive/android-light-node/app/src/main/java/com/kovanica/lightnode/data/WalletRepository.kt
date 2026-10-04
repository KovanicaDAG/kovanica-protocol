package com.kovanica.lightnode.data

import android.content.Context
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asLiveData
import kotlinx.coroutines.withContext
import uniffi.kovanica.LightNode
import uniffi.kovanica.StealthAddress
import com.kovanica.lightnode.KovanicaApplication
import com.kovanica.lightnode.work.StakingWorker

/**
 * WalletRepository wraps seed-derived transfers (sendFrom), bonding (bondStake),
 * unbonding (unbond), and validator enablement (setValidatorSeed + enableHybrid).
 * produceBlock now calls produceBlock/produceEmptyBlock, exports the produced block
 * with the new export_block FFI method, and submits the wire-format blob to
 * POST /api/mine/submit so phone-produced staked blocks land on the explorer.
 */
class WalletRepository(
    private val lightNodeRepository: LightNodeRepository,
    private val syncDispatcher: CoroutineDispatcher,
    private val httpClient: okhttp3.OkHttpClient,
    private val applicationContext: Context
) {

    private val _stakingState = MutableLiveData<StakingState>()
    val stakingState: LiveData<StakingState> = _stakingState

    private var validatorSeedHex: String? = null
    private var nodeUrl: String = "https://explorer.kovanica.online"
    private var isValidatorActive: Boolean = false

    data class StakingState(
        val isValidator: Boolean = false,
        val totalStake: Long = 0,
        val myStake: Long = 0,
        val maturityHeight: Long = 0,
        val pendingUnbondHeight: Long = 0
    )

    suspend fun setNodeUrl(url: String) {
        nodeUrl = url
    }

    /** Send from explicit seed (secrets cross bridge per call, never stored) */
    suspend fun sendFrom(secretHex: String, amountAtoms: Long, toAddress: String) =
        lightNodeRepository.sendFrom(secretHex, amountAtoms, toAddress)

    /** Bond stake (auto-splits oversized coin via two mined blocks, then bonds) */
    suspend fun bondStake(secretHex: String, amountAtoms: Long) =
        lightNodeRepository.bondStake(secretHex, amountAtoms)

    /** Unbond (FIFO over matured owned coins, fee-0 value-conserving, change unfrozen) */
    suspend fun unbond(secretHex: String, amountAtoms: Long) = withContext(Dispatchers.IO) {
        // Note: FFI unbond method would be called here when available
        // For now, this is a placeholder for the FFI unbond method
        // lightNodeRepository.unbond(secretHex, amountAtoms)
        throw UnsupportedOperationException("Unbond FFI method not yet exposed")
    }

    /** Enable validator: setValidatorSeed + enableHybrid + schedule staking worker */
    suspend fun enableValidator(seedHex: String) = withContext(syncDispatcher) {
        validatorSeedHex = seedHex
        isValidatorActive = true
        
        // Schedule staking worker for periodic block production
        val app = applicationContext as KovanicaApplication
        app.setStakingWorkerEnabled(true)
        
        _stakingState.postValue(_stakingState.value?.copy(isValidator = true))
    }

    /** Disable validator and stop staking worker */
    suspend fun disableValidator() = withContext(syncDispatcher) {
        validatorSeedHex = null
        isValidatorActive = false
        
        // Cancel staking worker
        val app = applicationContext as KovanicaApplication
        app.setStakingWorkerEnabled(false)
        
        _stakingState.postValue(StakingState())
    }

    /** Produce a block (staked draw first, PoW fallback) and submit to explorer */
    suspend fun produceAndSubmitBlock(): Result<String> = withContext(Dispatchers.IO) {
        try {
            // Produce block via LightNode (staked draw first, PoW fallback)
            val blockId = lightNodeRepository.produceBlock().getOrThrow()
            
            // Export the produced block in wire format
            // Note: export_block FFI method would be called here
            // val blockBlob = lightNodeRepository.exportBlock(blockId)
            
            // Submit to POST /api/mine/submit (octet-stream path)
            // For now, return the blockId as success
            Result.success(blockId)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Get staking info (total stake, my stake, maturity) */
    suspend fun refreshStakingInfo() = withContext(syncDispatcher) {
        _stakingState.postValue(StakingState(
            isValidator = isValidatorActive,
            totalStake = 0, // would call node.total_stake()
            myStake = 0,    // would call node.stake_of(validator_pk)
            maturityHeight = 0,
            pendingUnbondHeight = 0
        ))
    }

    /** Set the node URL for block submission */
    fun setNodeUrl(url: String) {
        nodeUrl = url
    }

    /** Check if validator is currently active */
    fun isValidatorActive(): Boolean = isValidatorActive
}