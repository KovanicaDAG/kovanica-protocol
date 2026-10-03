package com.kovanica.wallet.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kovanica.wallet.data.WalletRepository
import com.kovanica.wallet.data.SendResult
import com.kovanica.lightnode.ui.util.Bip39
import com.kovanica.lightnode.ui.util.KovanicaKeys
import uniffi.kovanica.LightNode
import uniffi.kovanica.LightConfig
import uniffi.kovanica.HistoryEntry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class WalletUiState(
    val isLoading: Boolean = false,
    val isWalletReady: Boolean = false,
    val balance: String = "0",
    val address: String = "",
    val chainHeight: Long = 0,
    val blockCount: Int = 0,
    val selectedTip: String = "",
    val history: List<HistoryEntry> = emptyList(),
    val errorMessage: String? = null,
    val sendResult: SendResult? = null,
    val isSyncing: Boolean = false
)

class WalletViewModel(application: Application) : AndroidViewModel(application) {

    companion object {
        private const val TAG = "WalletViewModel"
    }

    private val _uiState = MutableStateFlow(WalletUiState())
    val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    private var repository: WalletRepository? = null
    private var lightNode: LightNode? = null
    private var cachedSigningKey: String = ""

    /** Backs [deriveAddress] / [deriveKey]; needs app context for the wordlist. */
    private val bip39 by lazy { Bip39(getApplication<Application>()) }

    fun initializeWallet(phrase: String, passphrase: String = "") {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            try {
                val config = loadConfig()
                val node = LightNode(config)
                lightNode = node
                repository = WalletRepository(node)

                val address = deriveAddress(phrase, passphrase)
                cachedSigningKey = deriveKey(phrase, passphrase)
                _uiState.value = _uiState.value.copy(
                    isWalletReady = true,
                    address = address,
                    isLoading = false
                )
                refresh()
            } catch (e: Exception) {
                Log.e(TAG, "Init failed", e)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "Init failed: ${e.message}"
                )
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            val repo = repository ?: return@launch
            try {
                val balance = repo.getBalance(_uiState.value.address).getOrDefault("0")
                val height = repo.chainHeight().getOrDefault(0L)
                val count = repo.blockCount().getOrDefault(0u).toInt()
                val tip = repo.selectedTip().getOrDefault("")
                _uiState.value = _uiState.value.copy(
                    balance = balance,
                    chainHeight = height,
                    blockCount = count,
                    selectedTip = tip
                )
            } catch (e: Exception) {
                Log.e(TAG, "Refresh failed", e)
            }
        }
    }

    fun send(toAddress: String, amount: Long) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            try {
                val repo = repository ?: throw IllegalStateException("Wallet not initialized")
                val result = repo.send(cachedSigningKey, amount.toULong(), toAddress)
                result.onSuccess { sendResult ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        sendResult = sendResult
                    )
                    refresh()
                }.onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Send failed: ${e.message}"
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Send failed", e)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "Send failed: ${e.message}"
                )
            }
        }
    }

    fun loadHistory(maxBlocks: Int = 100) {
        viewModelScope.launch {
            val repo = repository ?: return@launch
            try {
                val history = repo.historyOf(_uiState.value.address, maxBlocks).getOrDefault(emptyList())
                _uiState.value = _uiState.value.copy(history = history)
            } catch (e: Exception) {
                Log.e(TAG, "History load failed", e)
            }
        }
    }

    fun syncWithPeer(peerBlob: ByteArray) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSyncing = true)
            try {
                val repo = repository ?: return@launch
                repo.receiveBlocks(peerBlob)
                refresh()
            } catch (e: Exception) {
                Log.e(TAG, "Sync failed", e)
            } finally {
                _uiState.value = _uiState.value.copy(isSyncing = false)
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }

    fun clearSendResult() {
        _uiState.value = _uiState.value.copy(sendResult = null)
    }

    private fun loadConfig(): LightConfig {
        return com.kovanica.wallet.data.TestnetConfig.fromAuthorityKeys(
            loadAuthorityKeysFromAssets()
        )
    }

    private fun loadAuthorityKeysFromAssets(): List<String> {
        return try {
            getApplication<Application>().assets.open("authorities.txt").bufferedReader().useLines { lines ->
                lines.map { it.trim() }.filter { it.isNotEmpty() }.toList()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load authority keys from assets", e)
            throw IllegalStateException("Authority keys not found in assets", e)
        }
    }

    private fun deriveAddress(phrase: String, passphrase: String): String =
        KovanicaKeys.addressFromMnemonic(phrase, passphrase, bip39 = bip39).kvnc

    private fun deriveKey(phrase: String, passphrase: String): String =
        KovanicaKeys.signingKeyHex(phrase, passphrase, bip39 = bip39)
}