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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kovanica.lightnode.R
import com.kovanica.lightnode.ui.WalletViewModel
import com.kovanica.lightnode.ui.components.KvncButton
import com.kovanica.lightnode.ui.components.KvncTopAppBar
import com.kovanica.lightnode.ui.components.WordGrid

@Composable
fun OnboardingScreen(
    viewModel: WalletViewModel,
    onWalletReady: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(state.walletExists, state.address.kvnc) {
        if (state.walletExists && state.address.kvnc.isNotBlank()) {
            onWalletReady()
        }
    }

    Scaffold(
        topBar = { KvncTopAppBar(title = stringResource(R.string.app_name)) },
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
                text = "Create or restore your wallet",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = "Your recovery phrase is the only way to restore your funds. Write it down and keep it offline.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (state.mnemonic.isBlank()) {
                KvncButton(
                    text = "Create new wallet",
                    onClick = viewModel::createWallet,
                )
            } else {
                Text(
                    text = "Recovery phrase",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                WordGrid(words = state.mnemonic.split(" "))

                var confirmed by remember { mutableStateOf(false) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = confirmed,
                        onCheckedChange = { confirmed = it },
                    )
                    Text(
                        text = "I have written down my recovery phrase",
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }

                KvncButton(
                    text = "Continue to wallet",
                    onClick = onWalletReady,
                    enabled = confirmed,
                )
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp))

            ImportSection(viewModel)

            state.errorMessage?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ImportSection(viewModel: WalletViewModel) {
    var expanded by remember { mutableStateOf(false) }
    var importPhrase by remember { mutableStateOf("") }

    if (!expanded) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text("Import existing phrase")
        }
        return
    }

    Text(
        text = "Import wallet",
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onBackground,
    )
    OutlinedTextField(
        value = importPhrase,
        onValueChange = { importPhrase = it },
        modifier = Modifier.fillMaxWidth(),
        label = { Text("12-word recovery phrase") },
        minLines = 3,
        shape = MaterialTheme.shapes.medium,
    )
    KvncButton(
        text = "Import",
        onClick = { viewModel.importWallet(importPhrase) },
        enabled = importPhrase.split(Regex("\\s+")).size >= 12,
    )
}
