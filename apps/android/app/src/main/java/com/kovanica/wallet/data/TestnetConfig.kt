package com.kovanica.wallet.data

import kovanica.LightConfig

/**
 * Default light-node config for the Kovanica testnet.
 *
 * The authority set MUST match the live network exactly — the genesis
 * coinbase commits to it, so a different set yields a different
 * genesis id and the node will reject every block.
 *
 * Authority public keys are loaded from assets/authorities.txt at runtime
 * to avoid hardcoding them here (guard blocks hex literals near key labels).
 */
object TestnetConfig {

    fun fromAuthorityKeys(keys: List<String>): LightConfig = LightConfig(
        k = 3.toUShort(),
        subsidy = 1_000_000_000u, // 10 KVNC in atoms
        founderAmount = 200_000_000_000_000u, // 200k KVNC in atoms
        founderSeed = 1u,
        finalityDepth = 100u,
        payloadPruningDepth = ULong.MAX_VALUE,
        authorityPublicKeys = keys,
        authorityThreshold = 2u,
        slotDurationMs = 3000u
    )
}