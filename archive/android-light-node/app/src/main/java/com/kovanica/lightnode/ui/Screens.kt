package com.kovanica.lightnode.ui

import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Column
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Row
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun SendScreen(
    viewModel: WalletViewModel,
    onBack: () -> Unit
) {
    var toAddress by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var seedHex by remember { mutableStateOf("") } // TODO: Get from secure storage

    val maxAmount = 100000000L // TODO: Get actual balance

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
            }
            Text("Send KVNC", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.padding(top = 16.dp))

        // To address
        OutlinedTextField(
            value = toAddress,
            onValueChange = { toAddress = it },
            label = { Text("Recipient address (kvnc…dag or hex)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            isError = error.isNotBlank(),
            supportingText = { if (error.isNotBlank()) Text(error) }
        )
        Spacer(modifier = Modifier.padding(top = 16.dp))

        // Amount
        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it.filter { it.isDigit() || it == '.' } },
            label = { Text("Amount (KVNC)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            supportingText = { Text("Max: ${Format.atomsToKvnc(maxAmount)} KVNC") }
        )
        Spacer(modifier = Modifier.padding(top = 16.dp))

        // Quick amounts
        Text("Quick amounts", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(1, 5, 10, 25, 50).forEach { kvnc ->
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = { amount = kvnc.toString() }
                ) {
                    Text("$kvnc KVNC")
                }
            }
        }
        Spacer(modifier = Modifier.padding(top = 24.dp))

        // Send button
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                error = ""
                val atoms = parseKvnc(amount) ?: 0L
                if (atoms <= 0) {
                    error = "Invalid amount"
                } else if (toAddress.trim().isEmpty()) {
                    error = "Recipient address required"
                } else if (atoms > maxAmount) {
                    error = "Insufficient balance"
                } else {
                    isSending = true
                    lifecycleScope.launch {
                        viewModel.sendFrom(seedHex, atoms, toAddress.trim())
                        isSending = false
                    }
                }
            },
            enabled = !isSending
        ) {
            if (isSending) {
                ProgressIndicator(modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.padding(end = 8.dp))
            }
            Text("Send")
        }

        if (error.isNotBlank()) {
            Text(error, color = Color.Red, fontSize = 14.sp)
        }
    }
}

@Composable
fun ReceiveScreen(
    onBack: () -> Unit
) {
    var address by remember { mutableStateOf("kvnc1EvFUfisEScFuZSqDXagC17m3bpP32B74dseMHtzQ5TNbdag") } // TODO: Get from wallet
    var copied by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
            }
            Text("Receive KVNC", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.padding(top = 16.dp))

        Text("Your address", fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(modifier = Modifier.padding(top = 8.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(address, fontSize = 14.sp, fontFamily = FontFamily.Monospace)
                    IconButton(onClick = {
                        // Copy to clipboard
                    }) {
                        Icon(
                            imageVector = if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                            contentDescription = "Copy"
                        )
                    }
                }
                Text("Tap to copy", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(modifier = Modifier.padding(top = 16.dp))

        Text("Share this address to receive KVNC", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("QR code coming in v0.2", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun HistoryScreen(
    onBack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
            }
            Text("Transaction History", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("No transactions yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Transactions will appear here after you send or receive", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun SettingsScreen(
    onBack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
            }
            Text("Settings", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Network", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Testnet (kovanica-testnet)")
                    Text("explorer.kovanica.online", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Divider()
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Node URL")
                    Text("https://explorer.kovanica.online", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Spacer(modifier = Modifier.padding(top = 16.dp))

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Security", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Seed stored in Android Keystore (AES/GCM)", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Biometric unlock: Coming in v0.2", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(modifier = Modifier.padding(top = 16.dp))

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("About", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Kovanica Light Node v0.1-testnet")
                Text("Built on Kovanica Protocol (BlockDAG, GHOSTDAG)")
                Text("License: MIT OR Apache-2.0")
            }
        }
    }
}