package com.kovanica.lightnode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kovanica.lightnode.ui.WalletViewModel
import com.kovanica.lightnode.ui.components.AmountInput
import com.kovanica.lightnode.ui.components.KvncButton
import com.kovanica.lightnode.ui.components.KvncTopAppBar

@Composable
fun SendScreen(
    viewModel: WalletViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var recipient by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }

    val isFormValid = recipient.isNotBlank() && amount.toDoubleOrNull() != null && amount.toDouble() > 0

    Scaffold(
        topBar = { KvncTopAppBar(title = "Send KVNC", onBack = onBack) },
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
                text = "Available: ${state.spendableBalance}",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = recipient,
                onValueChange = { recipient = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Recipient address") },
                placeholder = { Text("kvnc…dag or 66-digit hex") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                singleLine = true,
                shape = MaterialTheme.shapes.medium,
            )

            AmountInput(
                value = amount,
                onValueChange = { amount = it },
                label = "Amount",
                modifier = Modifier.fillMaxWidth(),
                suffix = "KVNC",
                imeAction = ImeAction.Done,
            )

            Text(
                text = "Network fee is paid in atoms and will be estimated by the node.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )


            KvncButton(
                text = "Send",
                onClick = { viewModel.send(recipient, amount) },
                enabled = isFormValid && !state.isLoading,
            )

            state.errorMessage?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}
