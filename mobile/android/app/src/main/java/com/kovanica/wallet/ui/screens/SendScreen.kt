package com.kovanica.wallet.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kovanica.wallet.util.Kvnc
import com.kovanica.wallet.viewmodel.WalletViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendScreen(
    onNavigateBack: () -> Unit,
    viewModel: WalletViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var toAddress by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var amountError by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Send KVNC") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            OutlinedTextField(
                value = toAddress,
                onValueChange = { toAddress = it },
                label = { Text("Recipient Address") },
                placeholder = { Text("kvnc1...") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = amount,
                onValueChange = {
                    amount = it
                    amountError = null
                },
                label = { Text("Amount (KVNC)") },
                placeholder = { Text("0.00") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                isError = amountError != null,
                supportingText = amountError?.let { { Text(it) } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
            )

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = {
                    val address = toAddress.trim()
                    if (address.isEmpty()) {
                        amountError = "Enter a recipient address"
                        return@Button
                    }
                    // Parse exactly, and refuse to send anything we cannot
                    // represent. The previous `?: 0.0 * 100_000_000` bound the
                    // elvis looser than the multiply, so the scaling was never
                    // applied and a 1.5 KVNC send went out as 1 atom.
                    val atoms = Kvnc.parseToAtoms(amount)
                    when {
                        atoms == null -> amountError = invalidAmountMessage(amount)
                        atoms == 0L -> amountError = "Amount must be at least 0.00000001 KVNC"
                        else -> {
                            amountError = null
                            viewModel.send(address, atoms)
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !uiState.isLoading && toAddress.isNotBlank() && amount.isNotBlank()
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Send")
                }
            }
            uiState.sendResult?.let { result ->
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Transaction Sent!",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "TX: ${result.txIdHex.take(20)}...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                        Text(
                            text = "Block: ${result.blockIdHex.take(20)}...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
                LaunchedEffect(result) {
                    viewModel.clearSendResult()
                }
            }

            uiState.errorMessage?.let { error ->
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Text(
                        text = error,
                        modifier = Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }
        }
    }
}

private fun invalidAmountMessage(input: String): String {
    val text = input.trim()
    return if (text.isEmpty()) "Enter an amount"
    else if (text.toBigDecimalOrNull() == null) "Amount must be a decimal number"
    else if (text.startsWith("-")) "Amount cannot be negative"
    else if (text.count { it == '.' } > 1) "Amount can have only one decimal point"
    else "Amount cannot have more than 8 decimal places (1 atom precision)"
}