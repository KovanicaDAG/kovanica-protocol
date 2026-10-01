package com.kovanica.lightnode.ui

import androidx.compose.material3.ActionButton
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Column
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ProgressIndicator
import androidx.compose.material3.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kovanica.lightnode.data.Format
import com.kovanica.lightnode.data.LightNodeRepository
import com.kovanica.lightnode.data.WalletRepository
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(
    viewModel: WalletViewModel,
    lightNodeRepository: LightNodeRepository,
    walletRepository: WalletRepository
) {
    val nodeState by viewModel.nodeState.observeAsState()
    val stakingState by viewModel.stakingState.observeAsState()

    val seedHex by remember { mutableStateOf("") } // TODO: Get from secure storage

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Balance Card
        BalanceCard(
            balance = "0.00000000",
            onRefresh = { viewModel.sync() }
        )

        // Staking Card
        StakingCard(
            isValidator = stakingState?.isValidator ?: false,
            myStake = stakingState?.myStake ?: 0,
            totalStake = stakingState?.totalStake ?: 0,
            onEnable = { viewModel.enableValidator("") },
            onDisable = { viewModel.disableValidator() },
            onProduce = { viewModel.produceBlock() },
            onRefresh = { viewModel.refreshStakingInfo() }
        )

        // Quick Actions
        QuickActionsCard(
            onSend = { /* navigate to send */ },
            onReceive = { /* navigate to receive */ },
            onSync = { viewModel.sync() },
            onHistory = { /* navigate to history */ }
        )

        // Node Status
        StatusCard(state = nodeState)
    }
}

@Composable
fun BalanceCard(
    balance: String,
    onRefresh: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Balance", fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                IconButton(onClick = onRefresh) {
                    Icon(
                        imageVector = Icons.Filled.Refresh,
                        contentDescription = "Refresh"
                    )
                }
            )
            Text("$balance KVNC", fontSize = 36.sp, fontWeight = FontWeight.Bold)
            Text("Tap to refresh", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun StakingCard(
    isValidator: Boolean,
    myStake: Long,
    totalStake: Long,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
    onProduce: () -> Unit,
    onRefresh: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Staking", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (isValidator) "ACTIVE" else "INACTIVE",
                        color = if (isValidator) Color.Green else Color.Red)
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                }
            }
            if (isValidator) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("My Stake", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${Format.atomsToKvnc(myStake)} KVNC", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("Total Stake", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${Format.atomsToKvnc(totalStake)} KVNC", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (isValidator) {
                    Button(modifier = Modifier.weight(1f), onClick = onProduce) {
                        Text("Produce Block")
                    }
                    OutlinedButton(modifier = Modifier.weight(1f), onClick = onDisable) {
                        Text("Disable Validator")
                    }
                } else {
                    Button(modifier = Modifier.weight(1f), onClick = onEnable) {
                        Text("Enable Validator")
                    }
                }
            }
        }
    }
}

@Composable
fun QuickActionsCard(
    onSend: () -> Unit,
    onReceive: () -> Unit,
    onSync: () -> Unit,
    onHistory: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Quick Actions", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionButton(icon = Icons.Filled.Send, label = "Send", onClick = onSend)
                ActionButton(icon = Icons.Filled.Download, label = "Receive", onClick = onReceive)
                ActionButton(icon = Icons.Filled.Sync, label = "Sync", onClick = onSync)
                ActionButton(icon = Icons.Filled.History, label = "History", onClick = onHistory)
            }
        }
    }
}

@Composable
fun ActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit
) {
    Button(
        modifier = Modifier
            .weight(1f)
            .fillMaxWidth()
            .padding(8.dp),
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(imageVector = icon, contentDescription = label, modifier = Modifier.size(24.dp))
            Text(label, fontSize = 12.sp)
        }
    }
}

@Composable
fun StatusCard(state: LightNodeRepository.NodeState?) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Node Status", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(
                    if (state?.isSyncing == true) "Syncing..." else "Ready",
                    color = if (state?.isSyncing == true) Color.Orange else Color.Green
                )
            }
            state?.let { s ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Height: ${s.blockHeight}")
                    Text("Peers: ${s.peerCount}")
                }
            }
        }
    }
}
