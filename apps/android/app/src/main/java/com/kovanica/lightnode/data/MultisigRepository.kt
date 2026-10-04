package com.kovanica.lightnode.data

import uniffi.kovanica.SendReceipt

/**
 * Wallet-side wrapper for RFC-001 M-of-N multisig operations.
 *
 * The FFI surface for multisig is landing with `phase5-multisig-node`; until
 * then every public method returns a clear [NotImplementedError] wrapped in a
 * [Result.failure] so callers can safely wire up the UX without crashing.
 */
class MultisigRepository(private val lightNode: LightNodeRepository) {

    /**
     * Create a P2SH multisig address from a threshold and a list of Ed25519
     * public keys (hex strings).
     */
    suspend fun createAddress(threshold: Int, publicKeysHex: List<String>): Result<String> {
        return phase5Stub()
    }

    /**
     * Build an unsigned spend transaction from a multisig address.
     */
    suspend fun buildSpend(
        multisigAddress: String,
        amountAtoms: ULong,
        toAddress: String,
    ): Result<ByteArray> {
        return phase5Stub()
    }

    /**
     * Produce a partial signature for a multisig spend using the wallet's key.
     */
    suspend fun signSpend(mnemonic: String, unsignedPayload: ByteArray): Result<ByteArray> {
        return phase5Stub()
    }

    /**
     * Combine enough partial signatures into a final witness.
     */
    suspend fun combineSignatures(partialSignatures: List<ByteArray>): Result<ByteArray> {
        return phase5Stub()
    }

    /**
     * Submit a fully signed multisig spend to the network.
     */
    suspend fun submitSpend(signedPayload: ByteArray): Result<SendReceipt> {
        return phase5Stub()
    }

    private fun <T> phase5Stub(): Result<T> {
        return Result.failure(
            NotImplementedError(
                "Multisig FFI wrapper awaiting phase5-multisig-node",
            ),
        )
    }
}
