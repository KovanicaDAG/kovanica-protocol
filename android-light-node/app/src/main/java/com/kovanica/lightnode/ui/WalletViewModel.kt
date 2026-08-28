package com.kovanica.lightnode.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kovanica.lightnode.data.LightNodeRepository
import com.kovanica.lightnode.data.NodeClient
import com.kovanica.lightnode.data.SecureSeedStorage
import com.kovanica.lightnode.data.WalletRepository
import com.kovanica.lightnode.data.formatKvnc
import com.kovanica.lightnode.ui.prefs.WalletPrefs
import com.kovanica.lightnode.ui.util.Bip39
import com.kovanica.lightnode.ui.util.KovanicaAddress
import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.kovanica.HistoryEntry

private const val ATOM: Long = 100_000_000L

/**
 * UI-facing ViewModel for the light-node wallet.
 *
 * The mnemonic is kept encrypted at rest via [SecureSeedStorage] and only
 * loaded into memory for key derivation and signing. Every chain-touching
 * operation is dispatched to [LightNodeRepository] / [WalletRepository],
 * which serialise FFI work on a dedicated background thread.
 */
class WalletViewModel(application: Application) : AndroidViewModel(application) {

    private val secureStorage = SecureSeedStorage(application)
    private val prefs = WalletPrefs(application)
    private val bip39 = Bip39(application)
    private val lightNode = LightNodeRepository(application)
    private val walletRepository = WalletRepository(application, lightNode)

    private val _uiState = MutableStateFlow(WalletUiState())
    val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    init {
        val savedMnemonic = secureStorage.loadMnemonic()
        if (savedMnemonic.isNullOrBlank()) {
            _uiState.value = WalletUiState(walletExists = false, nodeUrl = prefs.nodeUrl)
        } else {
            deriveFromMnemonic(savedMnemonic)
        }
    }

    /**
     * Create a brand-new wallet, encrypt the mnemonic, and derive the address.
     */
    fun createWallet() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            runCatching {
                withContext(Dispatchers.Default) {
                    val mnemonic = bip39.generateMnemonic()
                    val address = walletRepository.deriveAddress(mnemonic)
                    secureStorage.saveMnemonic(mnemonic)
                    Triple(mnemonic, address, Unit)
                }
            }.onSuccess { (mnemonic, address, _) ->
                _uiState.value = WalletUiState(
                    isLoading = false,
                    walletExists = true,
                    mnemonic = mnemonic,
                    address = address,
                    nodeUrl = prefs.nodeUrl,
                )
                onWalletReady(mnemonic)
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
            }
        }
    }

    /**
     * Import a wallet from a user-supplied BIP39 mnemonic.
     */
    fun importWallet(mnemonic: String) = importMnemonic(mnemonic)

    /**
     * Import a wallet from a user-supplied BIP39 mnemonic.
     */
    fun importMnemonic(mnemonic: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            runCatching {
                withContext(Dispatchers.Default) {
                    if (!bip39.validate(mnemonic)) {
                        throw IllegalArgumentException("Invalid recovery phrase")
                    }
                    val address = walletRepository.deriveAddress(mnemonic)
                    secureStorage.saveMnemonic(mnemonic)
                    Pair(mnemonic, address)
                }
            }.onSuccess { (savedMnemonic, address) ->
                _uiState.value = WalletUiState(
                    isLoading = false,
                    walletExists = true,
                    mnemonic = savedMnemonic,
                    address = address,
                    nodeUrl = prefs.nodeUrl,
                )
                onWalletReady(savedMnemonic)
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
            }
        }
    }

    /**
     * Re-derive the address from an already-saved mnemonic (e.g. on launch).
     */
    private fun deriveFromMnemonic(mnemonic: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            runCatching {
                withContext(Dispatchers.Default) {
                    val address = walletRepository.deriveAddress(mnemonic)
                    Pair(mnemonic, address)
                }
            }.onSuccess { (savedMnemonic, address) ->
                _uiState.value = WalletUiState(
                    isLoading = false,
                    walletExists = true,
                    mnemonic = savedMnemonic,
                    address = address,
                    nodeUrl = prefs.nodeUrl,
                )
                onWalletReady(savedMnemonic)
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
            }
        }
    }

    /**
     * Called once the wallet address is known: boot the node, load any
     * persisted light sync, then refresh balance, stake info and history.
     */
    private fun onWalletReady(mnemonic: String) {
        viewModelScope.launch {
            val address = _uiState.value.address
            lightNode.bootIfNeeded(prefs.nodeUrl)
            lightNode.loadLightSync()
            refreshBalance()
            refreshStakeInfo(mnemonic)
            refreshHistory()
        }
    }

    /**
     * Refresh the spendable balance from the chain.
     */
    fun refreshBalance() {
        viewModelScope.launch {
            val address = _uiState.value.address
            if (address.hex.isBlank()) return@launch

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            lightNode.balanceOfAddress(address.hex)
                .onSuccess { atoms ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        atomBalance = atoms,
                        spendableBalance = formatKvnc(atoms),
                    )
                    refreshHistory()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Pull the latest blocks from the configured seed node and apply them.
     */
    fun syncNode() {
        viewModelScope.launch {
            val address = _uiState.value.address
            if (address.hex.isBlank()) {
                _uiState.value = _uiState.value.copy(errorMessage = "No wallet address")
                return@launch
            }

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            lightNode.sync(prefs.nodeUrl, address.hex)
                .onSuccess { count ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Synced $count headers",
                    )
                    refreshBalance()
                    refreshHistory()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Build, sign and broadcast a transfer from the wallet's Ed25519 identity.
     */
    fun send(recipientAddress: String, amountKvnc: String) {
        viewModelScope.launch {
            val mnemonic = _uiState.value.mnemonic
            if (mnemonic.isBlank()) return@launch

            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null,
                lastSendReceipt = null,
            )

            val atomsResult = runCatching { kvncToAtoms(amountKvnc) }
            val atoms = atomsResult.getOrElse { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
                return@launch
            }

            walletRepository.send(mnemonic, recipientAddress.trim(), atoms)
                .onSuccess { receipt ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        lastSendReceipt = receipt,
                        errorMessage = "Sent in block ${receipt.blockIdHex.take(8)}…",
                    )
                    refreshBalance()
                    refreshHistory()
                    refreshStakeInfo()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Request testnet KVNC from the faucet for the wallet address.
     */
    fun requestFaucet() {
        viewModelScope.launch {
            val address = _uiState.value.address
            if (address.hex.isBlank()) {
                _uiState.value = _uiState.value.copy(errorMessage = "No wallet address")
                return@launch
            }

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            NodeClient(prefs.nodeUrl).requestFaucet(address.hex)
                .onSuccess { _ ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Faucet requested",
                    )
                    refreshBalance()
                    refreshHistory()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Bond spendable coins to this node's validator identity.
     */
    fun bond(amountKvnc: String) {
        viewModelScope.launch {
            val mnemonic = _uiState.value.mnemonic
            if (mnemonic.isBlank()) return@launch

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            val atomsResult = runCatching { kvncToAtoms(amountKvnc) }
            val atoms = atomsResult.getOrElse { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
                return@launch
            }
            walletRepository.bondStake(mnemonic, atoms)
                .onSuccess { txId ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isValidatorEnabled = true,
                        errorMessage = "Bonded: $txId",
                    )
                    refreshBalance()
                    refreshHistory()
                    refreshStakeInfo()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Unbond matured stake back to the wallet's actor address.
     */
    fun unbond(amountKvnc: String) {
        viewModelScope.launch {
            val mnemonic = _uiState.value.mnemonic
            if (mnemonic.isBlank()) return@launch

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            val atomsResult = runCatching { kvncToAtoms(amountKvnc) }
            val atoms = atomsResult.getOrElse { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
                return@launch
            }
            walletRepository.unbond(mnemonic, atoms)
                .onSuccess { receipt ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        lastSendReceipt = receipt,
                        errorMessage = "Unbonded in block ${receipt.blockIdHex.take(8)}…",
                    )
                    refreshBalance()
                    refreshHistory()
                    refreshStakeInfo()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Enable hybrid staking mode from a raw 32-byte validator seed.
     */
    fun enableStaking(seed: ByteArray) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            walletRepository.setValidatorSeedAndEnable(seed)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isValidatorEnabled = true,
                        errorMessage = "Staking enabled",
                    )
                    refreshStakeInfo()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Enable hybrid staking mode from the wallet mnemonic.
     */
    fun enableStaking() {
        viewModelScope.launch {
            val mnemonic = _uiState.value.mnemonic
            if (mnemonic.isBlank()) return@launch

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            val seed = withContext(Dispatchers.Default) {
                bip39.mnemonicToEd25519Seed(mnemonic)
            }
            walletRepository.setValidatorSeedAndEnable(seed)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isValidatorEnabled = true,
                        errorMessage = "Staking enabled",
                    )
                    refreshStakeInfo()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    /**
     * Produce a block using the phone's validator seed (staking mode) or PoW,
     * then submit it to the configured seed node.
     */
    fun produceBlock() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            walletRepository.produceAndSubmitBlock(prefs.nodeUrl)
                .onSuccess { blockId ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Produced block ${blockId.take(8)}…",
                    )
                    refreshBalance()
                    refreshHistory()
                    refreshStakeInfo()
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = error.localizedMessage ?: error.toString(),
                    )
                }
        }
    }

    fun updateNodeUrl(url: String) {
        prefs.nodeUrl = url
        _uiState.value = _uiState.value.copy(nodeUrl = url)
    }

    fun revealSeed(reveal: Boolean) {
        _uiState.value = _uiState.value.copy(revealSeed = reveal)
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }

    /**
     * Reset the wallet for testing / onboarding replay. Wipes the encrypted
     * mnemonic; connection settings are preserved.
     */
    fun resetWallet() {
        secureStorage.clear()
        _uiState.value = WalletUiState(nodeUrl = prefs.nodeUrl)
    }

    /**
     * Fetch recent on-chain history for the wallet address.
     */
    private fun refreshHistory() {
        viewModelScope.launch {
            val address = _uiState.value.address
            if (address.hex.isBlank()) return@launch

            lightNode.historyOf(address.hex, 100u)
                .onSuccess { history ->
                    _uiState.value = _uiState.value.copy(recentHistory = history.map { it.toUiModel() })
                }
        }
    }

    /**
     * Refresh validator stake summary. Swallows errors (e.g. validator not
     * yet set) so the rest of the UI stays responsive.
     */
    private fun refreshStakeInfo(mnemonic: String? = null) {
        viewModelScope.launch {
            val validatorSet = mnemonic?.let {
                runCatching { lightNode.validatorPublicKeyHex().getOrNull() != null }.getOrNull() ?: false
            } ?: _uiState.value.isValidatorEnabled

            val my = runCatching { lightNode.myStake().getOrThrow() }.getOrDefault("0")
            val total = runCatching { lightNode.totalStake().getOrThrow() }.getOrDefault("0")
            val pending = runCatching { lightNode.pendingUnbondHeight().getOrThrow() }.getOrNull()

            _uiState.value = _uiState.value.copy(
                isValidatorEnabled = validatorSet,
                myStake = formatKvnc(my),
                totalStake = formatKvnc(total),
                pendingUnbondHeight = pending,
            )
        }
    }

    private fun HistoryEntry.toUiModel(): HistoryItem = HistoryItem(
        blockIdHex = blockIdHex,
        txIdHex = txIdHex,
        direction = if (direction == uniffi.kovanica.TxDirection.RECEIVED) {
            TxDirection.RECEIVED
        } else {
            TxDirection.SENT
        },
        amount = formatKvnc(amount),
        timestamp = null,
    )

    private fun kvncToAtoms(amountKvnc: String): ULong {
        val decimal = BigDecimal(amountKvnc.trim())
        if (decimal.signum() <= 0) {
            throw IllegalArgumentException("Amount must be positive")
        }
        val atoms = decimal
            .multiply(BigDecimal.valueOf(ATOM))
            .setScale(0, RoundingMode.HALF_UP)
            .toBigInteger()

        val maxAtoms = BigInteger(ULong.MAX_VALUE.toString())
        if (atoms > maxAtoms) {
            throw IllegalArgumentException("Amount too large")
        }
        return atoms.toString().toULong()
    }

    override fun onCleared() {
        super.onCleared()
        lightNode.close()
    }
}
