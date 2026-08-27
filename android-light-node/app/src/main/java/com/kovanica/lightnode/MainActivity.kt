package com.kovanica.lightnode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.kovanica.LightConfig
import uniffi.kovanica.LightNode

private const val BOOTSTRAP_URL = "https://explorer.kovanica.online/api/bootstrap"
private const val BLOCKS_URL = "https://explorer.kovanica.online/api/blocks"

/**
 * Live testnet genesis params — must mirror `crates/kovanica-node`
 * explorer::genesis_node(): k=3, 200 KVNC subsidy + premine, founder seed 1,
 * ATOM = 100_000_000. `/api/bootstrap` exposes k/atom/pow but not the
 * subsidy/premine/seed, so v0.1 pins them here. Proven by
 * `crates/kovanica-ffi/tests/live_sync_spike.rs`.
 */
private val ATOM: ULong = 100_000_000u

private fun liveConfig() = LightConfig(
    k = 3u.toUShort(),
    subsidy = 200u * ATOM,
    founderAmount = 200u * ATOM,
    founderSeed = 1u,
    finalityDepth = ULong.MAX_VALUE,
    payloadPruningDepth = ULong.MAX_VALUE,
)

/** Slim JSON grab for the two fields we gate on. */
private fun jsonField(json: String, field: String): String? {
    val re = Regex("\"$field\"\\s*:\\s*\"([0-9a-fA-F]+)\"")
    return re.find(json)?.groupValues?.get(1)
}

private fun httpGet(url: String): ByteArray {
    val conn = URL(url).openConnection() as HttpURLConnection
    return try {
        conn.connectTimeout = 15_000
        conn.readTimeout = 120_000
        check(conn.responseCode == 200) { "HTTP ${conn.responseCode} for $url" }
        conn.inputStream.use { it.readBytes() }
    } finally {
        conn.disconnect()
    }
}

private data class GateResult(
    val localGenesis: String,
    val netGenesis: String?,
    val genesisMatch: Boolean,
    val count: Long,
    val localTip: String,
    val netTip: String?,
    val tipMatch: Boolean,
)

class MainActivity : ComponentActivity() {

    /** All Rust FFI work is serialized through one thread (the UniFFI node is
     * thread-safe, but sync/produce are order-sensitive and CPU-bound). */
    private val nodeScope = CoroutineScope(
        Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    )

    private var node: LightNode? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AppScreen() }
    }

    @Composable
    fun AppScreen() {
        var gate by remember { mutableStateOf<GateResult?>(null) }
        var error by remember { mutableStateOf<String?>(null) }
        var busy by remember { mutableStateOf(false) }
        var producedId by remember { mutableStateOf<String?>(null) }
        val scope = rememberCoroutineScope()

        LaunchedEffect(Unit) {
            busy = true
            try {
                gate = runGate()
            } catch (t: Throwable) {
                error = t.toString()
            }
            busy = false
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {
            Text("Kovanica Light Node — slice 9a gate", style = MaterialTheme.typography.titleLarge)
            Text("boots the FFI LightNode at live testnet params, pulls one /api/blocks, checks genesis + tip parity")
            HorizontalDivider(Modifier.padding(vertical = 8.dp))

            error?.let {
                Text("ERROR", color = MaterialTheme.colorScheme.error)
                Text(it)
            } ?: gate?.let { g ->
                Text("local genesis: ${g.localGenesis}")
                Text("net  genesis:  ${g.netGenesis}")
                Text("genesis match: ${g.genesisMatch}")
                Text("blocks: ${g.count}  (applied match: ${g.count == 10L})")
                Text("local tip: ${g.localTip}")
                Text("net  tip:  ${g.netTip}")
                Text("tip match: ${g.tipMatch}")
            } ?: if (busy) Text("gate running…") else Text("gate: idle")

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Button(
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            producedId = produceSanityBlock()
                        } catch (t: Throwable) {
                            error = t.toString()
                        }
                        busy = false
                    }
                },
                enabled = !busy,
            ) {
                Text("produce empty block (sanity)")
            }
            producedId?.let { Text("produced: $it") }
        }
    }

    /** Plan 9a step 4: staked/PoW block production through the JNA boundary.
     * Runs on the serialized FFI dispatcher; node is booted on first use. */
    private suspend fun produceSanityBlock(): String =
        withContext(nodeScope.coroutineContext) {
            val n = node ?: LightNode(liveConfig()).also { node = it }
            n.produceEmptyBlock().idHex
        }

    private suspend fun runGate(): GateResult {
        // All FFI + HTTP on the dedicated serialized dispatcher. This suspend
        // hops off the main thread so Compose stays responsive; the caller's
        // catch surfaces errors in the UI.
        return withContext(nodeScope.coroutineContext) {
            val netBootstrap = String(httpGet(BOOTSTRAP_URL))
            val netGenesis = jsonField(netBootstrap, "genesis")
            val netTip = jsonField(netBootstrap, "tip")

            val n = node ?: LightNode(liveConfig()).also { node = it }

            // Genesis parity WITHOUT network: the local node booted to the
            // same block the network anchors on.
            val localGenesis = n.blockById(netGenesis.orEmpty())?.idHex ?: "UNKNOWN"

            // Pull the live chain and import it.
            val blob = httpGet(BLOCKS_URL)
            val count = n.receiveBlocks(blob).toLong()
            val localTip = n.selectedTip()

            GateResult(
                localGenesis = localGenesis,
                netGenesis = netGenesis,
                genesisMatch = localGenesis == netGenesis,
                count = count,
                localTip = localTip,
                netTip = netTip,
                tipMatch = localTip == netTip,
            )
        }
    }
}