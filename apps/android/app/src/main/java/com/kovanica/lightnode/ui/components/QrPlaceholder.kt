package com.kovanica.lightnode.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlin.random.Random

/**
 * A deterministic QR-code placeholder. It is not a real QR code, but it gives
 * the user an immediate visual anchor for "scan this" while we decide on a
 * QR library for the integration pass.
 */
@Composable
fun QrPlaceholder(
    data: String,
    modifier: Modifier = Modifier,
    gridSize: Int = 9,
) {
    val random = Random(data.hashCode())
    val onSurface = MaterialTheme.colorScheme.onSurface
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant

    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(12.dp)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            repeat(gridSize) { row ->
                Row(modifier = Modifier.weight(1f)) {
                    repeat(gridSize) { col ->
                        val isDark = when {
                            // Corner markers
                            (row < 3 && col < 3) -> true
                            (row < 3 && col >= gridSize - 3) -> true
                            (row >= gridSize - 3 && col < 3) -> true
                            // Data noise
                            else -> random.nextBoolean()
                        }
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .padding(1.dp)
                                .fillMaxSize()
                                .background(
                                    color = if (isDark) onSurface else surfaceVariant,
                                    shape = RoundedCornerShape(2.dp),
                                )
                        )
                    }
                }
            }
        }
    }
}
