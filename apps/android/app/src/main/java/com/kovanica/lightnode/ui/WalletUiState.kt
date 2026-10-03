package com.kovanica.lightnode.ui

import com.kovanica.lightnode.ui.prefs.WalletPrefs
import com.kovanica.lightnode.ui.util.KovanicaAddress
import uniffi.kovanica.CoinJoinPrepared
import uniffi.kovanica.SendReceipt

data class WalletUiState(
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val walletExists: Boolean = false,
    val mnemonic: String = "",
    val address: KovanicaAddress.Address = KovanicaAddress.Address("", ""),
    val spendableBalance: String = "0 KVNC",
    val atomBalance: String = "0",
    val recentHistory: List<HistoryItem> = emptyList(),
    val nodeUrl: String = WalletPrefs.DEFAULT_NODE_URL,
    val revealSeed: Boolean = false,
    val isValidatorEnabled: Boolean = false,
    val myStake: String = "0 KVNC",
    val totalStake: String = "0 KVNC",
    val pendingUnbondHeight: String? = null,
    val lastSendReceipt: SendReceipt? = null,
    val coinJoinPrepared: CoinJoinPrepared? = null,
)

data class HistoryItem(
    val blockIdHex: String,
    val txIdHex: String,
    val direction: TxDirection,
    val amount: String,
    val timestamp: String? = null,
)

enum class TxDirection { SENT, RECEIVED }
