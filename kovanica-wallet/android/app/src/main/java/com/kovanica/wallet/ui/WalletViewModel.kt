package com.kovanica.wallet.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.kovanica.wallet.KovanicaWalletApp
import com.kovanica.wallet.data.WalletRepository
import com.kovanica.wallet.model.AddressInfo
import com.kovanica.wallet.model.ATOM
import com.kovanica.wallet.model.BootstrapInfo
import com.kovanica.wallet.model.FeeEstimate
import com.kovanica.wallet.model.HeadInfo
import com.kovanica.wallet.model.HistoryEntry
import com.kovanica.wallet.model.KVNC_SYMBOL
import com.kovanica.wallet.model.KVNC_TOKEN_NAME
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.math.RoundingMode

data class WalletUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val address: String = "",
    val balanceAtoms: Long = 0L,
    val head: HeadInfo? = null,
    val bootstrap: BootstrapInfo? = null,
    val feeEstimate: FeeEstimate? = null,
    val history: List<HistoryEntry> = emptyList(),
    val historyHasMore: Boolean = false,
    val faucetBusy: Boolean = false,
    val faucetMessage: String? = null,
) {
    val balanceFormatted: String
        get() {
            val kvnc = BigDecimal(balanceAtoms)
                .divide(BigDecimal(ATOM.toString()), 8, RoundingMode.HALF_UP)
                .stripTrailingZeros()
                .toPlainString()
            return "$kvnc KVNC"
        }

    val tokenName: String get() = KVNC_TOKEN_NAME
    val tokenSymbol: String get() = KVNC_SYMBOL
    val network: String get() = head?.network ?: bootstrap?.network ?: ""
}

class WalletViewModel(
    private val app: KovanicaWalletApp,
) : ViewModel() {

    private var repository: WalletRepository = app.repository()

    val nodeUrl: String get() = app.nodeUrl

    private val _uiState = MutableStateFlow(WalletUiState(address = repository.address))
    val uiState: StateFlow<WalletUiState> = _uiState

    private var historyOffset = 0
    private val historyPageSize = 25

    init {
        load()
    }

    fun setAddress(address: String) {
        repository.setAddress(address)
        _uiState.value = _uiState.value.copy(address = address)
        load()
    }

    fun setNodeUrl(url: String) {
        app.nodeUrl = url
        repository = app.repository()
        load()
    }

    fun load() {
        val addr = repository.address
        if (addr.isBlank()) {
            _uiState.value = _uiState.value.copy(isLoading = false, error = "No watch address set")
            return
        }
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            runCatching {
                val head = repository.loadHead()
                val bootstrap = repository.loadBootstrap()
                val fee = repository.loadFeeEstimate()
                val addrInfo = repository.loadAddress()
                val firstPage = repository.loadHistory(limit = historyPageSize, offset = 0)
                historyOffset = firstPage.size
                Trip(head, bootstrap, fee, addrInfo, firstPage)
            }.fold(
                onSuccess = { t ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = null,
                        address = addr,
                        head = t.head,
                        bootstrap = t.bootstrap,
                        feeEstimate = t.fee,
                        balanceAtoms = t.addr.balance,
                        history = t.history,
                        historyHasMore = t.history.size >= historyPageSize,
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Load failed",
                    )
                },
            )
        }
    }

    fun loadMoreHistory() {
        viewModelScope.launch {
            runCatching {
                repository.loadHistory(limit = historyPageSize, offset = historyOffset)
            }.onSuccess { page ->
                historyOffset += page.size
                val prev = _uiState.value
                _uiState.value = prev.copy(
                    history = prev.history + page,
                    historyHasMore = page.size >= historyPageSize,
                    isRefreshing = false,
                )
            }
        }
    }

    fun refresh() {
        _uiState.value = _uiState.value.copy(isRefreshing = true)
        load()
    }

    fun requestFaucet() {
        if (_uiState.value.faucetBusy || repository.address.isBlank()) return
        _uiState.value = _uiState.value.copy(faucetBusy = true, faucetMessage = null)
        viewModelScope.launch {
            runCatching { repository.requestFaucet() }.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        faucetBusy = false,
                        faucetMessage = "Faucet request sent",
                    )
                    load()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        faucetBusy = false,
                        faucetMessage = e.message ?: "Faucet request failed",
                    )
                },
            )
        }
    }

    override fun onCleared() {
        super.onCleared()
    }

    private data class Trip(
        val head: HeadInfo,
        val bootstrap: BootstrapInfo,
        val fee: FeeEstimate,
        val addr: AddressInfo,
        val history: List<HistoryEntry>,
    )

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as KovanicaWalletApp
                WalletViewModel(app)
            }
        }
    }
}
