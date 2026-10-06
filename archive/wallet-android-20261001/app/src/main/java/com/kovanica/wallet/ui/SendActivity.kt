package com.kovanica.wallet.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kovanica.wallet.BalanceInfo
import com.kovanica.wallet.WalletViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
class SendActivity : ComponentActivity() {

    private val viewModel: WalletViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    SendScreen(viewModel = viewModel)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendScreen(viewModel: WalletViewModel) {
    val balance by viewModel.balance.observeAsState(BalanceInfo(0, emptyMap()))
    var recipientAddress by remember { mutableStateOf("") }
    var amountText by remember { mutableStateOf("") }
    var feeText by remember { mutableStateOf("100000") }
    var selectedAsset by remember { mutableStateOf<String?>(null) }
    var isSending by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }

    val addresses = balance.assetBalances.keys.toList()
    val allAssets = listOf(null) + addresses // null = native KVNC

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Send") },
                navigationIcon = {
                    IconButton(onClick = { finish() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Asset selector
            Card(modifier = Modifier.fillMaxWidth()) {
                androidx.compose.foundation.layout.Column(modifier = Modifier.padding(16.dp)) {
                    Text("Asset", fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                    androidx.compose.material3.DropdownMenu(
                        expanded = true,
                        onDismissRequest = {},
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        allAssets.forEach { asset ->
                            androidx.compose.material3.DropdownMenuItem(
                                onClick = { selectedAsset = asset },
                                text = {
                                    Text(asset ?: "KVNC (Native)")
                                }
                            )
                        }
                    }
                }
            }

            // Recipient address
            OutlinedTextField(
                value = recipientAddress,
                onValueChange = { recipientAddress = it },
                label = { Text("Recipient Address") },
                placeholder = { Text("Enter Kovanica address") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                visualTransformation = VisualTransformation.None
            )

            // Amount
            OutlinedTextField(
                value = amountText,
                onValueChange = { amountText = it },
                label = { Text("Amount (${selectedAsset ?: "KVNC"})") },
                placeholder = { Text("0.00000000") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
            )

            // Fee
            OutlinedTextField(
                value = feeText,
                onValueChange = { feeText = it },
                label = { Text("Fee (atoms)") },
                placeholder = { Text("100000") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
            )

            // Error/Success messages
            if (errorMessage != null) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = androidx.compose.material3.CardDefaults.cardColors(
                        containerColor = androidx.compose.ui.graphics.Color.Red.copy(alpha = 0.1f)
                    )
                ) {
                    Text(errorMessage!!, color = androidx.compose.ui.graphics.Color.Red, modifier = Modifier.padding(16.dp))
                }
            }
            if (successMessage != null) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = androidx.compose.material3.CardDefaults.cardColors(
                        containerColor = androidx.compose.ui.graphics.Color.Green.copy(alpha = 0.1f)
                    )
                ) {
                    Text(successMessage!!, color = androidx.compose.ui.graphics.Color.Green, modifier = Modifier.padding(16.dp))
                }
            }

            // Send button
            Button(
                onClick = {
                    if (recipientAddress.isNotBlank() && amountText.isNotBlank()) {
                        sendTransaction()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !isSending && recipientAddress.isNotBlank() && amountText.isNotBlank()
            ) {
                if (isSending) {
                    androidx.compose.material3.CircularProgressIndicator(modifier = Modifier.size(24.dp))
                } else {
                    Text("Send Transaction", fontSize = 16.sp)
                }
            }
        }
    }

    fun sendTransaction() {
        isSending = true
        errorMessage = null
        successMessage = null

        val amountAtoms = (amountText.toDoubleOrNull() ?: 0.0 * 100_000_000).toLong()
        val feeAtoms = feeText.toLongOrNull() ?: 100000

        // Get first address from wallet (simplified)
        viewModel.getAddresses { addrs ->
            if (addrs.isNotEmpty()) {
                val fromAddress = addrs[0]
                if (selectedAsset == null) {
                    viewModel.sendNative(fromAddress, recipientAddress, amountAtoms, feeAtoms) { result ->
                        isSending = false
                        result.onSuccess { txId ->
                            successMessage = "Sent! TX: ${txId.take(16)}..."
                            amountText = ""
                        }.onFailure { e ->
                            errorMessage = "Failed: ${e.message}"
                        }
                    }
                } else {
                    viewModel.sendAsset(fromAddress, recipientAddress, selectedAsset!!, amountAtoms, feeAtoms) { result ->
                        isSending = false
                        result.onSuccess { txId ->
                            successMessage = "Sent! TX: ${txId.take(16)}..."
                            amountText = ""
                        }.onFailure { e ->
                            errorMessage = "Failed: ${e.message}"
                        }
                    }
                }
            } else {
                isSending = false
                errorMessage = "No addresses in wallet"
            }
        }
    }
}