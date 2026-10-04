package com.kovanica.lightnode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kovanica.lightnode.ui.WalletViewModel
import com.kovanica.lightnode.ui.components.AmountInput
import com.kovanica.lightnode.ui.components.KvncButton
import com.kovanica.lightnode.ui.components.KvncTopAppBar
import uniffi.kovanica.CoinJoinOutput
import uniffi.kovanica.CoinJoinParticipant
import uniffi.kovanica.CoinJoinPrepared

@Composable
fun CoinJoinScreen(
    viewModel: WalletViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val prepared = state.coinJoinPrepared

    var participant1Address by remember { mutableStateOf("") }
    var participant1Amount by remember { mutableStateOf("") }
    var participant1To by remember { mutableStateOf("") }
    var participant2Address by remember { mutableStateOf("") }
    var participant2Amount by remember { mutableStateOf("") }
    var participant2To by remember { mutableStateOf("") }

    Scaffold(
        topBar = { KvncTopAppBar(title = "CoinJoin", onBack = onBack) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(padding)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Spacer(Modifier.height(8.dp))

            Text(
                text = "CoinJoin — Privacy-Enhanced Batched Spend",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Text(
                text = "CoinJoin combines multiple participants' transactions into a single batch, " +
                    "improving privacy by making it harder to link inputs to outputs. " +
                    "Each participant provides their inputs and desired outputs, then signs their own inputs.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            HorizontalDivider()

            // Participant 1
            Text(
                text = "Participant 1 (You)",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            AmountInput(
                value = participant1Amount,
                onValueChange = { participant1Amount = it },
                label = "Amount to send (KVNC)",
                modifier = Modifier.fillMaxWidth(),
                suffix = "KVNC",
            )

            AmountInput(
                value = participant1To,
                onValueChange = { participant1To = it },
                label = "Recipient address",
                modifier = Modifier.fillMaxWidth(),
            )

            HorizontalDivider()

            // Participant 2
            Text(
                text = "Participant 2",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            AmountInput(
                value = participant2Address,
                onValueChange = { participant2Address = it },
                label = "Participant 2 address",
                modifier = Modifier.fillMaxWidth(),
            )

            AmountInput(
                value = participant2Amount,
                onValueChange = { participant2Amount = it },
                label = "Amount to send (KVNC)",
                modifier = Modifier.fillMaxWidth(),
                suffix = "KVNC",
            )

            AmountInput(
                value = participant2To,
                onValueChange = { participant2To = it },
                label = "Recipient address",
                modifier = Modifier.fillMaxWidth(),
            )

            HorizontalDivider()

            // Prepare button
            KvncButton(
                text = if (prepared == null) "Prepare CoinJoin" else "Re-prepare CoinJoin",
                onClick = {
                    val participants = buildParticipants(
                        participant1Address,
                        participant1Amount,
                        participant1To,
                        participant2Address,
                        participant2Amount,
                        participant2To,
                    )
                    if (participants.size >= 2) {
                        // viewModel.coinjoinPrepare(participants)  // TODO: CoinJoin not yet wired
                    }
                },
                enabled = participant1Amount.isNotBlank() && participant1To.isNotBlank() &&
                    participant2Amount.isNotBlank() && participant2To.isNotBlank(),
            )

            if (prepared != null) {
                PreparedCoinJoinView(prepared = prepared, viewModel = viewModel)
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun buildParticipants(
    p1Addr: String, p1Amt: String, p1To: String,
    p2Addr: String, p2Amt: String, p2To: String,
): List<CoinJoinParticipant> {
    val participants = mutableListOf<CoinJoinParticipant>()

    if (p1Amt.isNotBlank() && p1To.isNotBlank()) {
        val amt = p1Amt.toDoubleOrNull() ?: return participants
        val atoms = (amt * 100_000_000).toULong()
        participants.add(
            CoinJoinParticipant(
                from = p1Addr,
                outputs = listOf(
                    CoinJoinOutput(
                        amount = atoms.toString(),
                        to = p1To.trim(),
                        assetIdHex = null,
                    )
                ),
                assetIdHex = null,
            )
        )
    }

    if (p2Amt.isNotBlank() && p2To.isNotBlank()) {
        val amt = p2Amt.toDoubleOrNull() ?: return participants
        val atoms = (amt * 100_000_000).toULong()
        participants.add(
            CoinJoinParticipant(
                from = p2Addr,
                outputs = listOf(
                    CoinJoinOutput(
                        amount = atoms.toString(),
                        to = p2To.trim(),
                        assetIdHex = null,
                    )
                ),
                assetIdHex = null,
            )
        )
    }

    return participants
}

@Composable
private fun PreparedCoinJoinView(
    prepared: CoinJoinPrepared,
    viewModel: WalletViewModel,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = MaterialTheme.shapes.large,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "CoinJoin Prepared — Ready for Signatures",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Text(
                text = "Transaction: ${prepared.txHex.take(16)}…${prepared.txHex.takeLast(16)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text(
                text = "Fee: ${prepared.fee} atoms (${prepared.fee.toLong() / 100_000_000.0} KVNC)",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Text(
                text = "Inputs: ${prepared.outpointsHex.size}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Text(
                text = "Share the following with each participant so they can sign their inputs:\n\n" +
                    "Sighashes (all inputs share the same transaction sighash):\n" +
                    prepared.sighashesHex.joinToString("\n") +
                    "\n\nOutpoints:\n" +
                    prepared.outpointsHex.joinToString("\n") +
                    "\n\nValues (atoms):\n" +
                    prepared.values.joinToString("\n"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // Signatures input
            var signatures by remember { mutableStateOf(mutableListOf<String>()) }

            Text(
                text = "Signatures (one per input, 64-byte hex):",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                prepared.outpointsHex.withIndex().forEach { (idx, _) ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = "Input ${idx + 1}:",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        TextField(
                            value = signatures.getOrNull(idx) ?: "",
                            onValueChange = { val newList = signatures.toMutableList(); newList.set(idx, it); signatures = newList },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                    }
                }
            }

            KvncButton(
                text = "Submit CoinJoin",
                onClick = {
                    // viewModel.coinjoinSubmit(prepared, signatures)  // TODO: CoinJoin not yet wired
                },
                enabled = signatures.all { it.isNotBlank() && it.length == 128 },
            )
        }
    }
}

@Composable
private fun HorizontalDivider() {
    androidx.compose.material3.HorizontalDivider(
        modifier = Modifier.padding(vertical = 8.dp),
        color = MaterialTheme.colorScheme.outline,
    )
}