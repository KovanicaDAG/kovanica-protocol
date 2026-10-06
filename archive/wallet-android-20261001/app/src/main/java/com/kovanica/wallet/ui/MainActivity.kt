package com.kovanica.wallet.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Sync
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.Lifecycle
import com.kovanica.wallet.LightSyncState
import com.kovanica.wallet.WalletViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
class MainActivity : ComponentActivity() {

    private val viewModel: WalletViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    WalletScreen(viewModel = viewModel)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(viewModel: WalletViewModel) {
    val scrollState = rememberScrollState()
    val syncState by viewModel.syncState.observeAsState(LightSyncState.IDLE)
    val balance by viewModel.balance.observeAsState(com.kovanica.wallet.BalanceInfo(0, emptyMap()))
    val peerCount by viewModel.peerCount.observeAsState(0)
    val height by viewModel.height.observeAsState(0L)
    val isSyncing by viewModel.isSyncing.observeAsState(false)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kovanica Wallet") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                ),
                actions = {
                    IconButton(onClick = { /* Settings */ }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    IconButton(onClick = { viewModel.startLightSync() }) {
                        Icon(
                            if (isSyncing) Icons.Default.Sync else Icons.Default.Refresh,
                            contentDescription = if (isSyncing) "Syncing..." else "Sync"
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Sync Status Card
            SyncStatusCard(syncState = syncState, peerCount = peerCount, height = height, isSyncing = isSyncing)

            // Balance Card
            BalanceCard(balance = balance)

            // Quick Actions
            QuickActionsCard(viewModel = viewModel)

            // Recent Transactions
            RecentTransactionsCard(viewModel = viewModel)
        }
    }
}

@Composable
fun SyncStatusCard(
    syncState: LightSyncState,
    peerCount: Int,
    height: Long,
    isSyncing: Boolean
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = androidx.compose.material3.CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Network Status", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(
                    syncState.name,
                    color = when (syncState) {
                        LightSyncState.SYNCED -> Color.Green
                        LightSyncState.SYNCING -> Color.Orange
                        else -> Color.Gray
                    },
                    fontWeight = FontWeight.Medium
                )
            }
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Peers: $peerCount")
                Text("Height: $height")
            }
            if (isSyncing) {
                androidx.compose.material3.LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
fun BalanceCard(balance: com.kovanica.wallet.BalanceInfo) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = androidx.compose.material3.CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Total Balance", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
            Text(
                String.format("%.8f KVNC", balance.totalValueKvnc),
                fontSize = 36.sp,
                fontWeight = FontWeight.Bold
            )
            if (balance.assetBalances.isNotEmpty()) {
                androidx.compose.foundation.layout.Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    balance.assetBalances.forEach { (assetId, amount) ->
                        androidx.compose.foundation.layout.Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(assetId.take(12) + "...", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(String.format("%.8f", amount / 100_000_000.0))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun QuickActionsCard(viewModel: WalletViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Quick Actions", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                ActionButton(
                    icon = Icons.Default.Send,
                    label = "Send",
                    onClick = { /* Navigate to Send */ }
                )
                ActionButton(
                    icon = Icons.Default.ArrowDownward,
                    label = "Receive",
                    onClick = { /* Navigate to Receive */ }
                )
                ActionButton(
                    icon = Icons.Default.SwapHoriz,
                    label = "Swap",
                    onClick = { /* Navigate to Swap/DEX */ }
                )
                ActionButton(
                    icon = Icons.Default.QrCode,
                    label = "Scan",
                    onClick = { /* Navigate to QR Scanner */ }
                )
            }
        }
    }
}

@Composable
fun ActionButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    androidx.compose.material3.Button(
        onClick = onClick,
        modifier = Modifier.weight(1f).fillMaxWidth(),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        androidx.compose.foundation.layout.Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(icon, contentDescription = label, tint = MaterialTheme.colorScheme.primary)
            Text(label, fontSize = 12.sp)
        }
    }
}

@Composable
fun RecentTransactionsCard(viewModel: WalletViewModel) {
    val transactions by viewModel.transactions.observeAsState(emptyList())

    Card(modifier = Modifier.fillMaxWidth()) {
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Recent Transactions", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text("View All", color = MaterialTheme.colorScheme.primary)
            }
            if (transactions.isEmpty()) {
                Text("No transactions yet", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp))
            } else {
                transactions.take(5).forEach { tx ->
                    TransactionRow(transaction = tx)
                }
            }
        }
    }
}

@Composable
fun TransactionRow(transaction: com.kovanica.wallet.TransactionInfo) {
    val isIncoming = transaction.outputs.any { it.amount > 0 } // Simplified
    val amount = transaction.outputs.sumOf { it.amount } - transaction.inputs.sumOf { it.amount }

    androidx.compose.foundation.layout.Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        androidx.compose.foundation.layout.Column(
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                "${transaction.txId.take(8)}...${transaction.txId.takeLast(8)}",
                fontWeight = FontWeight.Medium
            )
            Text(
                "Block ${transaction.height} • ${formatTimestamp(transaction.timestamp)}",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Text(
            "${if (amount >= 0) "+" else ""}${amount / 100_000_000.0} KVNC",
            color = if (amount >= 0) Color.Green else Color.Red,
            fontWeight = FontWeight.Bold
        )
    }
}

fun formatTimestamp(timestamp: Long): String {
    return java.text.SimpleDateFormat("MMM dd, HH:mm", java.util.Locale.getDefault())
        .format(java.util.Date(timestamp * 1000))
}