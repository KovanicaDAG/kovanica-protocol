package com.kovanica.lightnode.ui

import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Column
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.lifecycle.lifecycleScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun OnboardingScreen(
    onComplete: (String) -> Unit, // seed hex
    viewModel: WalletViewModel
) {
    var mode by remember { mutableStateOf(Mode.Create) }
    var mnemonic by remember { mutableStateOf("") }
    var mnemonicError by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }

    enum class Mode { Create, Import }

    androidx.compose.material3.Scaffold(
        containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surface
    ) { padding ->
        androidx.compose.material3.Box(
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            androidx.compose.material3.Column(
                modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center
            ) {
                androidx.compose.material3.Text(
                    text = "Kovanica Light Node",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface
                )
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 8.dp))
                androidx.compose.material3.Text(
                    text = "Create a new wallet or import existing seed",
                    fontSize = 16.sp,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.TextAlign.Center
                )
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 32.dp))

                // Mode selector
                androidx.compose.material3.Row(
                    modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                    horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp)
                ) {
                    androidx.compose.material3.Button(
                        modifier = androidx.compose.ui.Modifier.weight(1f),
                        onClick = { mode = Mode.Create },
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                            containerColor = if (mode == Mode.Create) androidx.compose.material3.MaterialTheme.colorScheme.primary else androidx.compose.material3.MaterialTheme.colorScheme.surfaceContainerHighest
                        )
                    ) {
                        androidx.compose.material3.Text("Create New")
                    }
                    androidx.compose.material3.OutlinedButton(
                        modifier = androidx.compose.ui.Modifier.weight(1f),
                        onClick = { mode = Mode.Import }
                    ) {
                        androidx.compose.material3.Text("Import Seed")
                    }
                }
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 24.dp))

                if (mode == Mode.Create) {
                    CreateWalletScreen(onComplete = onComplete)
                } else {
                    ImportWalletScreen(onComplete = onComplete)
                }
            }
        }
    }
}

@Composable
fun CreateWalletScreen(onComplete: (String) -> Unit) {
    var mnemonic by remember { mutableStateOf("") }
    var showMnemonic by remember { mutableStateOf(false) }
    var isGenerating by remember { mutableStateOf(false) }
    var generatedMnemonic by remember { mutableStateOf("") }

    androidx.compose.material3.Column(
        modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)
    ) {
        androidx.compose.material3.Text(
            text = "New Wallet",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
        androidx.compose.material3.Text(
            text = "Generate a new 24-word BIP39 mnemonic. Write it down and store it securely.",
            fontSize = 14.sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
        )

        if (!showMnemonic) {
            androidx.compose.material3.Button(
                modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                onClick = {
                    isGenerating = true
                    // TODO: Call FFI to generate mnemonic
                    // For now, simulate
                    generatedMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
                    showMnemonic = true
                    isGenerating = false
                },
                enabled = !isGenerating
            ) {
                if (isGenerating) {
                    androidx.compose.material3.ProgressIndicator(modifier = androidx.compose.ui.Modifier.size(20.dp))
                    androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(end = 8.dp))
                }
                androidx.compose.material3.Text("Generate Mnemonic")
            }
        } else {
            androidx.compose.material3.Card(
                modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                colors = androidx.compose.material3.CardDefaults.cardColors(
                    containerColor = androidx.compose.material3.MaterialTheme.colorScheme.primaryContainer
                )
            ) {
                androidx.compose.material3.Column(
                    modifier = androidx.compose.ui.Modifier.padding(16.dp),
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp)
                ) {
                    androidx.compose.material3.Row(
                        modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween
                    ) {
                        androidx.compose.material3.Text(
                            text = "Your 24-word mnemonic",
                            fontWeight = FontWeight.Bold,
                            color = androidx.compose.material3.MaterialTheme.colorScheme.onPrimaryContainer
                        )
                        androidx.compose.material3.IconButton(onClick = { showMnemonic = false }) {
                            androidx.compose.material3.Icon(
                                imageVector = androidx.compose.material.icons.Icons.Filled.Close,
                                contentDescription = "Hide"
                            )
                        }
                    }
                    androidx.compose.material3.Text(
                        text = generatedMnemonic,
                        fontSize = 14.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        color = androidx.compose.material3.MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    androidx.compose.material3.Text(
                        text = "⚠️ Write this down. Anyone with this seed controls your funds.",
                        fontSize = 12.sp,
                        color = androidx.compose.material3.MaterialTheme.colorScheme.error
                    )
                    androidx.compose.material3.Button(
                        modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                        onClick = { onComplete(generatedMnemonic) }
                    ) {
                        androidx.compose.material3.Text("I've Written It Down → Continue")
                    }
                }
            }
        }
    }
}

@Composable
fun ImportWalletScreen(onComplete: (String) -> Unit) {
    var mnemonic by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var isValidating by remember { mutableStateOf(false) }

    androidx.compose.material3.Column(
        modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)
    ) {
        androidx.compose.material3.Text(
            text = "Import Wallet",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
        androidx.compose.material3.Text(
            text = "Enter your 24-word BIP39 mnemonic (space-separated).",
            fontSize = 14.sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
        )

        androidx.compose.material3.OutlinedTextField(
            value = mnemonic,
            onValueChange = { mnemonic = it },
            label = { androidx.compose.material3.Text("24-word mnemonic") },
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            singleLine = false,
            minLines = 4,
            maxLines = 6,
            isError = error.isNotBlank(),
            supportingText = { if (error.isNotBlank()) androidx.compose.material3.Text(error) }
        )

        androidx.compose.material3.Button(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            onClick = {
                error = ""
                if (mnemonic.trim().split(" ").filter { it.isNotBlank() }.size != 24) {
                    error = "Must be exactly 24 words"
                } else {
                    // TODO: Validate mnemonic via FFI
                    onComplete(mnemonic.trim())
                }
            },
            enabled = !isValidating
        ) {
            if (isValidating) {
                androidx.compose.material3.ProgressIndicator(modifier = androidx.compose.ui.Modifier.size(20.dp))
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(end = 8.dp))
            }
            androidx.compose.material3.Text("Import Wallet")
        }
    }
}