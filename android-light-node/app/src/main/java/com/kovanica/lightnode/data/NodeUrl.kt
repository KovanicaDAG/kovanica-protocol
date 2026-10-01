package com.kovanica.lightnode.data

import kotlinx.serialization.Serializable

@Serializable
data class ApiBootstrap(
    val network: String,
    val genesis: String,
    val tip: String,
    val blocks: Long,
    val minFee: Long,
    val atom: Long,
    val token: String,
    val k: Int,
    val subsidy: Long,
    val founderAmount: Long,
    val founderSeed: Int,
    val finalityDepth: Long,
    val payloadPruningDepth: Long,
    val listen: String,
    val peers: List<String>,
    val pow: Boolean
)

@Serializable
data class ApiState(
    val node: NodeState,
    val faucet: Boolean
)

@Serializable
data class NodeState(
    val blocks: Long,
    val tip: String,
    val genesis: String
)

@Serializable
data class PrepareResponse(
    val ok: Boolean,
    val sighash: String,
    val value: Long,
    val fee: Long,
    val change: Long,
    val assetId: String,
    val outpoint: Outpoint,
    val feeAssetId: String
)

@Serializable
data class Outpoint(
    val tx: String,
    val index: Int,
    val assetId: String
)