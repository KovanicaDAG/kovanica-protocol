package com.kovanica.lightnode.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.kovanica.CoinJoinOutput
import uniffi.kovanica.CoinJoinParticipant
import uniffi.kovanica.CoinJoinPrepared
import uniffi.kovanica.SendReceipt
import com.kovanica.lightnode.ui.util.Bip39
import com.kovanica.lightnode.ui.util.KovanicaAddress
import com.kovanica.lightnode.ui.util.KovanicaKeys

/**
 * Wallet-level operations: seed derivation, transfers, bonding, staking
 * enablement, and block production/uplink.
 *
 * The mnemonic stays encrypted in [SecureSeedStorage]; this repository only
 * derives the Ed25519 seed in memory for the duration of an operation.
 */
class WalletRepository(
    context: Context,
    private val lightNode: LightNodeRepository,
) {

    private val bip39 = Bip39(context)

    /**
     * Derive the wallet address from a BIP39 mnemonic.
     *
     * Goes through [KovanicaKeys] so this agrees with the CLI, the node and
     * the FFI. Do not shortcut to the raw BIP-39 material: the derivation
     * path is part of the address, and skipping it moves the whole balance.
     */
    suspend fun deriveAddress(mnemonic: String): KovanicaAddress.Address =
        withContext(Dispatchers.Default) {
            KovanicaKeys.addressFromMnemonic(mnemonic, bip39 = bip39)
        }

    /**
     * Build, sign and broadcast a transfer.
     */
    suspend fun send(
        mnemonic: String,
        toAddress: String,
        amountAtoms: ULong,
    ): Result<SendReceipt> {
        val secretHex = withContext(Dispatchers.Default) {
            mnemonicToSecretHex(mnemonic)
        }
        return lightNode.sendFrom(secretHex, amountAtoms, toAddress.trim())
    }

    /**
     * Bond spendable coins to this node's validator identity.
     *
     * The wallet's Ed25519 seed is reused as the VRF validator seed, and the
     * bond transaction spends from / returns change to the wallet address
     * derived from that same seed.
     * TODO: Not yet exposed in FFI
     */
    /*suspend fun bondStake(mnemonic: String, amountAtoms: ULong): Result<String> {
        val secretHex = withContext(Dispatchers.Default) {
            mnemonicToSecretHex(mnemonic)
        }
        return lightNode.setValidatorSeed(secretHex).fold(
            onSuccess = { lightNode.bondStakeFromSecret(secretHex, amountAtoms) },
            onFailure = { Result.failure(it) },
        )
    }

    /**
     * Unbond matured stake back to the wallet address derived from the
     * mnemonic.
     * TODO: Not yet exposed in FFI
     */
    suspend fun unbond(mnemonic: String, amountAtoms: ULong): Result<SendReceipt> {
        val secretHex = withContext(Dispatchers.Default) {
            mnemonicToSecretHex(mnemonic)
        }
        return lightNode.unbondFromSecret(secretHex, amountAtoms)
    }

    /**
     * Set the 32-byte validator [seed] and enable hybrid admission with
     * sensible v0.1 defaults.
     * TODO: Not yet exposed in FFI
     */
    suspend fun setValidatorSeedAndEnable(seed: ByteArray): Result<Unit> {
        return lightNode.setValidatorSeed(seed).fold(
            onSuccess = { lightNode.enableHybrid() },
            onFailure = { Result.failure(it) },
        )
    }*/

    /**
     * Produce a block and, if one is produced, export it as a wire-format blob
     * and submit it to [nodeUrl] over HTTP.
     *
     * Returns the block id on success.
     */
    suspend fun produceAndSubmitBlock(nodeUrl: String): Result<String> {
        return lightNode.produceBlock().fold(
            onSuccess = { blockInfo ->
                if (blockInfo == null) {
                    Result.failure(IllegalStateException("No block produced"))
                } else {
                    lightNode.exportBlock(blockInfo.idHex).fold(
                        onSuccess = { bytes ->
                            if (bytes == null) {
                                Result.failure(IllegalStateException("Block export returned null"))
                            } else {
                                NodeClient(NodeUrl(nodeUrl)).submitBlock(bytes).fold(
                                    onSuccess = { Result.success(blockInfo.idHex) },
                                    onFailure = { Result.failure(it) },
                                )
                            }
                        },
                        onFailure = { Result.failure(it) },
                    )
                }
            },
            onFailure = { Result.failure(it) },
        )
    }

    private fun mnemonicToSecretHex(mnemonic: String): String =
        KovanicaKeys.signingKeyHex(mnemonic, bip39 = bip39)

    // ------------------------------------------------------------------
    // CoinJoin (node-level batched spends)
    // ------------------------------------------------------------------

    /**
     * Prepare an unsigned CoinJoin transaction with multiple participants.
     * Each participant provides their address, desired outputs, and optional asset.
     * Returns a CoinJoinPrepared object with the transaction and sighashes to sign.
     */
    suspend fun coinjoinPrepare(
        participants: List<CoinJoinParticipant>
    ): Result<CoinJoinPrepared> {
        return lightNode.coinjoinPrepare(participants)
    }

    /**
     * Submit a fully signed CoinJoin transaction.
     * @param prepared The prepared CoinJoin from [coinjoinPrepare]
     * @param signaturesHex List of 64-byte Ed25519 signatures (lowercase hex), one per input
     * @return "submitted" on success
     */
    suspend fun coinjoinSubmit(
        prepared: CoinJoinPrepared,
        signaturesHex: List<String>
    ): Result<String> {
        return lightNode.coinjoinSubmit(prepared, signaturesHex)
    }
}
