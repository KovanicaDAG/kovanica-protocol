package com.kovanica.lightnode.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.kovanica.lightnode.ui.HistoryItem
import com.kovanica.lightnode.ui.TxDirection

@Composable
fun HistoryItemCard(
    item: HistoryItem,
    modifier: Modifier = Modifier,
) {
    val directionLabel = when (item.direction) {
        TxDirection.SENT -> "Sent"
        TxDirection.RECEIVED -> "Received"
    }
    val amountColor = when (item.direction) {
        TxDirection.SENT -> MaterialTheme.colorScheme.error
        TxDirection.RECEIVED -> MaterialTheme.colorScheme.secondary
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "$directionLabel · ${item.amount}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = amountColor,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                )
                Text(
                    text = "Block ${item.blockIdHex}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Tx ${item.txIdHex}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            item.timestamp?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
