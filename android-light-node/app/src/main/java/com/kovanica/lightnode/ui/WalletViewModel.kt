package com.kovanica.lightnode.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kovanica.lightnode.data.LightNodeRepository
import com.kovanica.lightnode.data.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.asLiveData

class WalletViewModel(
    private val lightNodeRepository: LightNodeRepository,
    private val walletRepository: WalletRepository
) : androidx.lifecycle.ViewModel() {

    val nodeState = lightNodeRepository.nodeState

    val stakingState = walletRepository.stakingState

    /** Initialize light node on first run */
    fun initialize() {
        viewModelScope.launch(Dispatchers.IO) {
            lightNodeRepository.initialize()
        }
    }

    /** Trigger full light sync */
    fun sync() {
        viewModelScope.launch(Dispatchers.IO) {
            lightNodeRepository.sync()
        }
    }

    /** Send from seed */
    fun sendFrom(secretHex: String, amountAtoms: Long, toAddress: String) {
        viewModelScope.launch(Dispatchers.IO) {
            lightNodeRepository.sendFrom(secretHex, amountAtoms, toAddress)
        }
    }

    /** Bond stake */
    fun bondStake(secretHex: String, amountAtoms: Long) {
        viewModelScope.launch(Dispatchers.IO) {
            lightNodeRepository.bondStake(secretHex, amountAtoms)
        }
    }

    /** Enable validator */
    fun enableValidator(seedHex: String) {
        viewModelScope.launch(Dispatchers.IO) {
            walletRepository.enableValidator(seedHex)
        }
    }

    /** Produce and submit block */
    fun produceBlock() {
        viewModelScope.launch(Dispatchers.IO) {
            walletRepository.produceAndSubmitBlock()
        }
    }

    /** Refresh staking info */
    fun refreshStakingInfo() {
        viewModelScope.launch(Dispatchers.IO) {
            walletRepository.refreshStakingInfo()
        }
    }
}