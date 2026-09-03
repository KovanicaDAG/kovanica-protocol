package com.kovanica.wallet.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kovanica.wallet.R
import com.kovanica.wallet.data.KovApi
import com.kovanica.wallet.ui.WalletUiState
import com.kovanica.wallet.ui.WalletViewModel
import com.kovanica.wallet.ui.theme.KvncGold

@Composable
fun HomeScreen(
    viewModel: WalletViewModel,
    onReceive: () -> Unit,
    onHistory: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(40.dp))

            Box(
                modifier = Modifier
                    .size(112.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painter = painterResource(id = R.drawable.kvnc_logo),
                    contentDescription = null,
                    modifier = Modifier
                        .size(96.dp)
                        .clip(CircleShape),
                )
            }

            Spacer(Modifier.height(20.dp))

            NetworkBadge(state.network)

            if (state.address.isBlank()) {
                Spacer(Modifier.height(24.dp))
                SetupSection(viewModel)
            } else {
                WalletContent(state, viewModel, onReceive, onHistory)
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SetupSection(viewModel: WalletViewModel) {
    var addressInput by remember { mutableStateOf("") }
    var nodeUrlInput by remember { mutableStateOf(viewModel.nodeUrl.ifBlank { KovApi.KOVANICA_API_DEFAULT }) }
    var showNodeUrl by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))

        Text(
            text = "Welcome to Kovanica Wallet",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(8.dp))

        Text(
            text = "This is a read-only, receive + faucet wallet. Enter your Kovanica address (kvnc...dag) to watch its balance and history from the node.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(20.dp))

        OutlinedTextField(
            value = addressInput,
            onValueChange = { addressInput = it },
            label = { Text("Kovanica address (kvnc…dag)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(8.dp))

        OutlinedButton(
            onClick = { showNodeUrl = !showNodeUrl },
            modifier = Modifier.align(Alignment.Start),
        ) {
            Text("Node URL (optional)")
        }

        if (showNodeUrl) {
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = nodeUrlInput,
                onValueChange = { nodeUrlInput = it },
                label = { Text("Node URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
                if (nodeUrlInput.isNotBlank() && nodeUrlInput != viewModel.nodeUrl) {
                    viewModel.setNodeUrl(nodeUrlInput)
                }
                if (addressInput.isNotBlank()) {
                    viewModel.setAddress(addressInput.trim())
                }
            },
            enabled = addressInput.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text("Set watch address")
        }
    }
}

@Composable
private fun WalletContent(
    state: WalletUiState,
    viewModel: WalletViewModel,
    onReceive: () -> Unit,
    onHistory: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))

        Text(
            text = "Wallet Balance",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(4.dp))

        if (state.isLoading) {
            CircularProgressIndicator(modifier = Modifier.size(32.dp))
        } else {
            Text(
                text = state.balanceFormatted,
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
                color = KvncGold,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = state.address,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        Spacer(Modifier.height(12.dp))

        state.error?.let { err ->
            Text(
                text = err,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.weight(1f))

        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Button(
                onClick = onReceive,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Receive")
            }

            OutlinedButton(
                onClick = onHistory,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("History")
            }

            Button(
                onClick = { viewModel.requestFaucet() },
                enabled = !state.faucetBusy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                if (state.faucetBusy) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                } else {
                    Text("Request testnet KVNC")
                }
            }

            OutlinedButton(
                onClick = {},
                enabled = false,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Send (coming soon - requires signing)")
            }
        }

        state.faucetMessage?.let { msg ->
            Spacer(Modifier.height(12.dp))
            Text(
                text = msg,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun NetworkBadge(network: String) {
    Card(
        shape = RoundedCornerShape(50),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(KvncGold, CircleShape),
            )
            Spacer(Modifier.size(8.dp))
            Text(
                text = "KVNC · ${network.ifBlank { "kovanica-testnet" }}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
