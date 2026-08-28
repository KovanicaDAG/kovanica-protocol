package com.kovanica.lightnode.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.kovanica.SendReceipt
import com.kovanica.lightnode.ui.util.Bip39
import com.kovanica.lightnode.ui.util.KovanicaAddress

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
     */
    suspend fun deriveAddress(mnemonic: String): KovanicaAddress.Address =
        withContext(Dispatchers.Default) {
            val seed = bip39.mnemonicToEd25519Seed(mnemonic)
            KovanicaAddress.fromSeed(seed)
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
     */
    suspend fun bondStake(mnemonic: String, amountAtoms: ULong): Result<String> {
        val seed = withContext(Dispatchers.Default) {
            bip39.mnemonicToEd25519Seed(mnemonic)
        }
        val secretHex = withContext(Dispatchers.Default) {
            seed.joinToString("") { "%02x".format(it) }
        }
        return lightNode.setValidatorSeed(seed).fold(
            onSuccess = { lightNode.bondStakeFromSecret(secretHex, amountAtoms) },
            onFailure = { Result.failure(it) },
        )
    }

    /**
     * Unbond matured stake back to the wallet address derived from the
     * mnemonic.
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
     */
    suspend fun setValidatorSeedAndEnable(seed: ByteArray): Result<Unit> {
        return lightNode.setValidatorSeed(seed).fold(
            onSuccess = { lightNode.enableHybrid() },
            onFailure = { Result.failure(it) },
        )
    }

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
                                NodeClient(nodeUrl).submitBlock(bytes).fold(
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

    private fun mnemonicToSecretHex(mnemonic: String): String {
        val seed = bip39.mnemonicToEd25519Seed(mnemonic)
        return seed.joinToString("") { "%02x".format(it) }
    }
}
