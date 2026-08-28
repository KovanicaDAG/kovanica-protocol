package com.kovanica.lightnode.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kovanica.lightnode.data.NodeRepository
import com.kovanica.lightnode.data.SecureSeedStorage
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

private const val ATOM: Long = 100_000_000L

/**
 * UI-facing ViewModel for the light-node wallet.
 *
 * The mnemonic is kept encrypted at rest via [SecureSeedStorage] and only
 * loaded into memory for key derivation and signing. Every chain-touching
 * operation is dispatched to [NodeRepository], which serialises FFI work on
 * a dedicated background thread.
 */
class WalletViewModel(application: Application) : AndroidViewModel(application) {

    private val secureStorage = SecureSeedStorage(application)
    private val prefs = WalletPrefs(application)
    private val bip39 = Bip39(application)
    private val nodeRepository = NodeRepository()

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
                    val seed = bip39.mnemonicToEd25519Seed(mnemonic)
                    val address = KovanicaAddress.fromSeed(seed)
                    secureStorage.saveMnemonic(mnemonic)
                    Triple(mnemonic, address, seed)
                }
            }.onSuccess { (mnemonic, address, seed) ->
                _uiState.value = WalletUiState(
                    isLoading = false,
                    walletExists = true,
                    mnemonic = mnemonic,
                    address = address,
                    nodeUrl = prefs.nodeUrl,
                )
                onWalletReady(seed)
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
    fun importWallet(mnemonic: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            runCatching {
                withContext(Dispatchers.Default) {
                    if (!bip39.validate(mnemonic)) {
                        throw IllegalArgumentException("Invalid recovery phrase")
                    }
                    val seed = bip39.mnemonicToEd25519Seed(mnemonic)
                    val address = KovanicaAddress.fromSeed(seed)
                    secureStorage.saveMnemonic(mnemonic)
                    Triple(mnemonic, address, seed)
                }
            }.onSuccess { (savedMnemonic, address, seed) ->
                _uiState.value = WalletUiState(
                    isLoading = false,
                    walletExists = true,
                    mnemonic = savedMnemonic,
                    address = address,
                    nodeUrl = prefs.nodeUrl,
                )
                onWalletReady(seed)
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
                    val seed = bip39.mnemonicToEd25519Seed(mnemonic)
                    KovanicaAddress.fromSeed(seed) to seed
                }
            }.onSuccess { (address, seed) ->
                _uiState.value = WalletUiState(
                    isLoading = false,
                    walletExists = true,
                    mnemonic = mnemonic,
                    address = address,
                    nodeUrl = prefs.nodeUrl,
                )
                onWalletReady(seed)
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
            }
        }
    }

    /**
     * Called once the wallet address is known: boot the node, refresh balance,
     * stake info and history.
     */
    private fun onWalletReady(seed: ByteArray) {
        viewModelScope.launch {
            nodeRepository.bootIfNeeded(prefs.nodeUrl)
            refreshBalance()
            refreshStakeInfo(seed)
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
            runCatching {
                nodeRepository.refreshBalance(address.hex)
            }.onSuccess { (atomBalance, spendableBalance) ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    atomBalance = atomBalance,
                    spendableBalance = spendableBalance,
                )
                refreshHistory()
            }.onFailure { error ->
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
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            nodeRepository.syncNode(prefs.nodeUrl)
                .onSuccess { count ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = "Synced $count blocks",
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

            val result = runCatching {
                val seed = withContext(Dispatchers.Default) {
                    bip39.mnemonicToEd25519Seed(mnemonic)
                }
                val secretHex = seed.joinToString("") { "%02x".format(it) }
                val atoms = kvncToAtoms(amountKvnc)
                nodeRepository.send(secretHex, atoms, recipientAddress.trim())
            }

            result.onSuccess { sendResult ->
                sendResult
                    .onSuccess { receipt ->
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            lastSendReceipt = receipt,
                            errorMessage = "Sent in block ${receipt.blockIdHex.take(8)}…",
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
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
            }
        }
    }

    /**
     * Bond spendable coins to this node's validator identity.
     *
     * v0.1 maps the wallet's Ed25519 seed directly to the validator seed and
     * derives the spending actor from the first 8 bytes of that seed. See
     * [NodeRepository.bond] for the limitation around the actor address.
     */
    fun bond(amountKvnc: String) {
        viewModelScope.launch {
            val mnemonic = _uiState.value.mnemonic
            if (mnemonic.isBlank()) return@launch

            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)

            val result = runCatching {
                val seed = withContext(Dispatchers.Default) {
                    bip39.mnemonicToEd25519Seed(mnemonic)
                }
                val atoms = kvncToAtoms(amountKvnc)
                nodeRepository.bond(seed, atoms)
            }

            result.onSuccess { bondResult ->
                bondResult
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
            }.onFailure { error ->
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

            val result = runCatching {
                val seed = withContext(Dispatchers.Default) {
                    bip39.mnemonicToEd25519Seed(mnemonic)
                }
                val atoms = kvncToAtoms(amountKvnc)
                val fromSeed = seed.first8BytesLittleEndian()
                nodeRepository.unbond(fromSeed, atoms)
            }

            result.onSuccess { unbondResult ->
                unbondResult
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
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = error.localizedMessage ?: error.toString(),
                )
            }
        }
    }

    /**
     * Produce a block using the phone's validator seed (staking mode) or PoW.
     */
    fun produceBlock() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            nodeRepository.produceBlock()
                .onSuccess { blockInfo ->
                    val message = blockInfo?.let {
                        "Produced block ${it.idHex.take(8)}…"
                    } ?: "No block produced"
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        errorMessage = message,
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

            nodeRepository.historyOf(address.hex, 100u)
                .onSuccess { history ->
                    _uiState.value = _uiState.value.copy(recentHistory = history)
                }
        }
    }

    /**
     * Refresh validator stake summary. Swallows errors (e.g. validator not
     * yet set) so the rest of the UI stays responsive.
     */
    private fun refreshStakeInfo(seed: ByteArray? = null) {
        viewModelScope.launch {
            val validatorSet = seed?.let {
                runCatching { nodeRepository.validatorPublicKeyHex() }.getOrNull() != null
            } ?: _uiState.value.isValidatorEnabled

            runCatching {
                val my = nodeRepository.myStake()
                val total = nodeRepository.totalStake()
                val pending = nodeRepository.pendingUnbondHeight()
                Triple(my, total, pending)
            }.onSuccess { (my, total, pending) ->
                _uiState.value = _uiState.value.copy(
                    isValidatorEnabled = validatorSet,
                    myStake = formatKvnc(my),
                    totalStake = formatKvnc(total),
                    pendingUnbondHeight = pending,
                )
            }
        }
    }

    private fun ByteArray.first8BytesLittleEndian(): ULong {
        var value = 0UL
        for (i in 0..7) {
            value = value or (this[i].toUByte().toULong() shl (8 * i))
        }
        return value
    }

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
        nodeRepository.close()
    }
}
