package com.kovanica.lightnode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kovanica.lightnode.ui.WalletViewModel
import com.kovanica.lightnode.ui.components.AmountInput
import com.kovanica.lightnode.ui.components.KvncButton
import com.kovanica.lightnode.ui.components.KvncTopAppBar

@Composable
fun StakingScreen(
    viewModel: WalletViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var bondAmount by remember { mutableStateOf("") }

    Scaffold(
        topBar = { KvncTopAppBar(title = "Staking", onBack = onBack) },
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

            StakeSummary(state)

            AmountInput(
                value = bondAmount,
                onValueChange = { bondAmount = it },
                label = "Amount to bond / unbond",
                modifier = Modifier.fillMaxWidth(),
                suffix = "KVNC",
            )

            KvncButton(
                text = "Bond stake",
                onClick = { viewModel.bond(bondAmount) },
                enabled = bondAmount.toDoubleOrNull() != null && bondAmount.toDouble() > 0,
            )

            KvncButton(
                text = "Unbond stake",
                onClick = { viewModel.unbond(bondAmount) },
                enabled = bondAmount.toDoubleOrNull() != null && bondAmount.toDouble() > 0,
            )

            HorizontalDivider()

            RowWithSwitch(
                label = "Enable hybrid staking",
                checked = state.isValidatorEnabled,
                onCheckedChange = { /* TODO: enableHybrid */ },
            )

            KvncButton(
                text = "Produce block now",
                onClick = viewModel::produceBlock,
            )

            Text(
                text = "Staking requires a matured bond and the validator seed to be set. These actions will be wired to the FFI node in the integration pass.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun StakeSummary(state: com.kovanica.lightnode.ui.WalletUiState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = MaterialTheme.shapes.large,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SummaryLine("My stake", state.myStake)
            SummaryLine("Total stake", state.totalStake)
            state.pendingUnbondHeight?.let {
                SummaryLine("Pending unbond at height", it)
            }
        }
    }
}

@Composable
private fun SummaryLine(label: String, value: String) {
    RowWithSpaceBetween {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun HorizontalDivider() {
    androidx.compose.material3.HorizontalDivider(
        modifier = Modifier.padding(vertical = 8.dp),
        color = MaterialTheme.colorScheme.outline,
    )
}

@Composable
private fun RowWithSwitch(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    RowWithSpaceBetween {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun RowWithSpaceBetween(content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        content()
    }
}
