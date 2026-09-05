package com.kovanica.lightnode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Toll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kovanica.lightnode.ui.WalletViewModel
import com.kovanica.lightnode.ui.components.ActionButton
import com.kovanica.lightnode.ui.components.AddressCard
import com.kovanica.lightnode.ui.components.HistoryItemCard
import com.kovanica.lightnode.ui.components.KvncTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletHomeScreen(
    viewModel: WalletViewModel,
    onSend: () -> Unit,
    onReceive: () -> Unit,
    onHistory: () -> Unit,
    onStake: () -> Unit,
    onSettings: () -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = { KvncTopAppBar(title = "Wallet") },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isLoading,
            onRefresh = viewModel::refreshBalance,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                item {
                    AddressCard(
                        address = state.address,
                        onCopy = { /* TODO: copy to clipboard */ },
                        onShowQr = onReceive,
                    )
                }

                item { BalanceCard(balance = state.spendableBalance) }

                item {
                    Text(
                        text = "Actions",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Spacer(Modifier.height(12.dp))
                    ActionGrid(
                        onSync = viewModel::syncNode,
                        onSend = onSend,
                        onReceive = onReceive,
                        onStake = onStake,
                        onHistory = onHistory,
                        onSettings = onSettings,
                    )
                }

                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "Recent activity",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        IconButton(onClick = onHistory) {
                            Icon(
                                imageVector = Icons.Filled.List,
                                contentDescription = "All history",
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }

                if (state.recentHistory.isEmpty()) {
                    item {
                        Text(
                            text = "No transactions yet. Pull down to refresh after syncing.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(state.recentHistory.take(5), key = { it.txIdHex }) { item ->
                        HistoryItemCard(item = item)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionGrid(
    onSync: () -> Unit,
    onSend: () -> Unit,
    onReceive: () -> Unit,
    onStake: () -> Unit,
    onHistory: () -> Unit,
    onSettings: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton(
                icon = Icons.Default.Refresh,
                label = "Sync",
                onClick = onSync,
                modifier = Modifier.weight(1f),
            )
            ActionButton(
                icon = Icons.Default.Send,
                label = "Send",
                onClick = onSend,
                modifier = Modifier.weight(1f),
            )
            ActionButton(
                icon = Icons.Default.Add,
                label = "Receive",
                onClick = onReceive,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton(
                icon = Icons.Default.Toll,
                label = "Stake",
                onClick = onStake,
                modifier = Modifier.weight(1f),
            )
            ActionButton(
                icon = Icons.Default.History,
                label = "History",
                onClick = onHistory,
                modifier = Modifier.weight(1f),
            )
            ActionButton(
                icon = Icons.Default.Settings,
                label = "Settings",
                onClick = onSettings,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun BalanceCard(balance: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        shape = MaterialTheme.shapes.large,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
        ) {
            Text(
                text = "Spendable balance",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = balance,
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
