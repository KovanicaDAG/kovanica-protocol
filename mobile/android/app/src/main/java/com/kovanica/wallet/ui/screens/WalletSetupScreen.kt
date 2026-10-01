package com.kovanica.wallet.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kovanica.wallet.util.MnemonicUtil
import com.kovanica.wallet.viewmodel.WalletViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletSetupScreen(
    onWalletReady: () -> Unit,
    viewModel: WalletViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var phrase by remember { mutableStateOf("") }
    var passphrase by remember { mutableStateOf("") }
    var showPassphrase by remember { mutableStateOf(false) }
    var showCreateWalletFlow by remember { mutableStateOf(false) }
    var generatedPhrase by remember { mutableStateOf("") }
    var currentStep by remember { mutableStateOf(CreateWalletStep.GENERATE) }

    val context = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(uiState.isWalletReady) {
        if (uiState.isWalletReady) {
            onWalletReady()
        }
    }

    if (showCreateWalletFlow) {
        CreateNewWalletScreen(
            onBack = { showCreateWalletFlow = false; currentStep = CreateWalletStep.GENERATE },
            onPhraseGenerated = { newPhrase ->
                generatedPhrase = newPhrase
                currentStep = CreateWalletStep.CONFIRM
            },
            onConfirmed = { confirmedPhrase, confirmedPassphrase ->
                viewModel.initializeWallet(confirmedPhrase, confirmedPassphrase)
                showCreateWalletFlow = false
            },
            currentStep = currentStep,
            generatedPhrase = generatedPhrase,
            context = context
        )
    } else {
        Scaffold { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(modifier = Modifier.height(32.dp))

                Text(
                    text = "Kovanica Wallet",
                    style = MaterialTheme.typography.headlineMedium
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Enter your backup phrase to restore your wallet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(24.dp))

                OutlinedTextField(
                    value = phrase,
                    onValueChange = { phrase = it },
                    label = { Text("Backup Phrase") },
                    placeholder = { Text("word1 word2 word3...") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 5
                )

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    label = { Text("Passphrase (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = if (showPassphrase) PasswordVisualTransformation() else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
                )

                Spacer(modifier = Modifier.height(24.dp))

                Button(
                    onClick = { viewModel.initializeWallet(phrase, passphrase) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !uiState.isLoading && phrase.isNotBlank()
                ) {
                    if (uiState.isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Text("Restore Wallet")
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedButton(
                    onClick = { showCreateWalletFlow = true },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Create New Wallet")
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
}

enum class CreateWalletStep {
    GENERATE, CONFIRM
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateNewWalletScreen(
    onBack: () -> Unit,
    onPhraseGenerated: (String) -> Unit,
    onConfirmed: (String, String) -> Unit,
    currentStep: CreateWalletStep,
    generatedPhrase: String,
    context: Context
) {
    var passphrase by remember { mutableStateOf("") }
    var showPassphrase by remember { mutableStateOf(false) }
    var confirmPhrase by remember { mutableStateOf("") }
    var wordsEntered by remember { mutableStateOf(0) }

    val words = generatedPhrase.split(" ")
    val selectedWordIndex = wordsEntered
    val expectedWord = if (selectedWordIndex < words.size) words[selectedWordIndex] else ""

    if (currentStep == CreateWalletStep.GENERATE) {
        // Generate phrase immediately on entering this screen
        LaunchedEffect(Unit) {
            val phrase = MnemonicUtil.generateMnemonic(context)
            onPhraseGenerated(phrase)
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = when (currentStep) {
                    CreateWalletStep.GENERATE -> "Generating Wallet..."
                    CreateWalletStep.CONFIRM -> "Write Down Your Backup Phrase"
                },
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(16.dp))

            when (currentStep) {
                CreateWalletStep.GENERATE -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Creating your new wallet...", style = MaterialTheme.typography.bodyMedium)
                }
                CreateWalletStep.CONFIRM -> {
                    // Warning card
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row {
                                Icon(
                                    imageVector = Icons.Default.Warning,
                                    contentDescription = "Warning",
                                    tint = MaterialTheme.colorScheme.error
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "IMPORTANT: Write down these 12 words in order. This is the only way to recover your wallet.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Mnemonic display
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceContainerHighest
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            LazyColumn(
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                items(words.chunked(3)) { chunk ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceEvenly
                                    ) {
                                        chunk.forEachIndexed { index, word ->
                                            val wordIndex = words.indexOf(word)
                                            Text(
                                                text = "${wordIndex + 1}. $word",
                                                style = MaterialTheme.typography.titleMedium,
                                                fontFamily = FontFamily.Monospace
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Confirmation step
                    if (wordsEntered < words.size) {
                        OutlinedTextField(
                            value = confirmPhrase,
                            onValueChange = {
                                confirmPhrase = it
                                val inputWords = it.split(" ").filter { it.isNotBlank() }
                                wordsEntered = inputWords.size
                            },
                            label = { Text("Enter word #${wordsEntered + 1} ($expectedWord)") },
                            placeholder = { Text("Type word here") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Text,
                                imeAction = ImeAction.Next
                            )
                        )
                    } else {
                        // Passphrase field after confirmation
                        OutlinedTextField(
                            value = passphrase,
                            onValueChange = { passphrase = it },
                            label = { Text("Passphrase (optional)") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            visualTransformation = if (showPassphrase) PasswordVisualTransformation() else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        Button(
                            onClick = { onConfirmed(generatedPhrase, passphrase) },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !generatedPhrase.isNullOrBlank()
                        ) {
                            Text("Continue")
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            TextButton(onClick = onBack) {
                Text("Back")
            }
        }
    }
}