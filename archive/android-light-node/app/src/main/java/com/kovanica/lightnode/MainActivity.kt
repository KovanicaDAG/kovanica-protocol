package com.kovanica.lightnode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.BottomNavigation
import androidx.compose.material3.BottomNavigationItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.lifecycle.lifecycleScope
import com.kovanica.lightnode.data.LightNodeRepository
import com.kovanica.lightnode.ui.HomeScreen
import com.kovanica.lightnode.ui.OnboardingScreen
import com.kovanica.lightnode.ui.ReceiveScreen
import com.kovanica.lightnode.ui.SendScreen
import com.kovanica.lightnode.ui.HistoryScreen
import com.kovanica.lightnode.ui.SettingsScreen
import com.kovanica.lightnode.ui.WalletViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val lightNodeRepository: LightNodeRepository by lazy {
        val app = application as KovanicaApplication
        LightNodeRepository(this, app.getSyncDispatcher())
    }

    private val walletViewModel: WalletViewModel by viewModels {
        androidx.lifecycle.ViewModelProvider.Factory { clazz ->
            WalletViewModel(lightNodeRepository, WalletRepository(lightNodeRepository, app.getSyncDispatcher(), okhttp3.OkHttpClient()))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KovanicaLightNodeTheme {
                MainScreen(viewModel = walletViewModel)
            }
        }
        
        // Initialize light node on first launch
        lifecycleScope.launch {
            walletViewModel.initialize()
        }
    }
}

@Composable
fun MainScreen(viewModel: WalletViewModel) {
    val nodeState by viewModel.nodeState.observeAsState()
    var currentScreen by remember { mutableStateOf<Screen>(Screen.Home) }
    var seedHex by remember { mutableStateOf("") }

    when {
        nodeState == null || !nodeState.isInitialized -> {
            GenesisGateScreen(onVerified = { viewModel.sync() })
        }
        else -> {
            // Check if seed is set (onboarding complete)
            if (seedHex.isEmpty()) {
                OnboardingScreen(
                    onComplete = { seed ->
                        seedHex = seed
                        // TODO: Store seed securely in Keystore
                    },
                    viewModel = viewModel
                )
            } else {
                ScaffoldWithNav(currentScreen = currentScreen, onScreenChange = { currentScreen = it }, seedHex = seedHex)
            }
        }
    }
}

enum class Screen {
    Home(Icons.Filled.Home),
    Send(Icons.Filled.Send),
    Receive(Icons.Filled.Download),
    History(Icons.Filled.History),
    Settings(Icons.Filled.Settings);

    private val icon: androidx.compose.ui.graphics.vector.ImageVector
    constructor(icon: androidx.compose.ui.graphics.vector.ImageVector) {
        this.icon = icon
    }
}

@Composable
fun ScaffoldWithNav(
    currentScreen: Screen,
    onScreenChange: (Screen) -> Unit,
    seedHex: String,
    viewModel: WalletViewModel
) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Main content
            when (currentScreen) {
                Screen.Home -> HomeScreen(viewModel, seedHex)
                Screen.Send -> SendScreen(viewModel = viewModel, onBack = { onScreenChange(Screen.Home) })
                Screen.Receive -> ReceiveScreen(onBack = { onScreenChange(Screen.Home) })
                Screen.History -> HistoryScreen(onBack = { onScreenChange(Screen.Home) })
                Screen.Settings -> SettingsScreen(onBack = { onScreenChange(Screen.Home) })
            }

            // Bottom navigation
            BottomNavigation(
                backgroundColor = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Screen.values().forEach { screen ->
                    BottomNavigationItem(
                        icon = { Icon(imageVector = screen.icon, contentDescription = screen.name) },
                        label = { Text(screen.name) },
                        selected = currentScreen == screen,
                        onClick = { onScreenChange(screen) },
                        selectedContentColor = MaterialTheme.colorScheme.primary,
                        unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
fun HomeScreen(viewModel: WalletViewModel, seedHex: String) {
    HomeScreen(viewModel = viewModel, lightNodeRepository = (viewModel as WalletViewModel).lightNodeRepository, walletRepository = (viewModel as WalletViewModel).walletRepository)
}

@Composable
fun GenesisGateScreen(onVerified: () -> Unit) {
    var status by remember { mutableStateOf("Connecting to live network...") }
    
    androidx.compose.material3.Scaffold(
        containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surface
    ) { padding ->
        androidx.compose.material3.Box(
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            contentAlignment = androidx.compose.ui.Alignment.Center
        ) {
            androidx.compose.material3.Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center
            ) {
                androidx.compose.material3.Icon(
                    imageVector = androidx.compose.material.icons.Icons.Filled.Sync,
                    contentDescription = "Syncing",
                    modifier = androidx.compose.ui.Modifier.size(64.dp),
                    tint = androidx.compose.material3.MaterialTheme.colorScheme.primary
                )
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 16.dp))
                androidx.compose.material3.Text(
                    text = "Kovanica Light Node",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface
                )
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 8.dp))
                androidx.compose.material3.Text(
                    text = "Genesis gate: verifying live network parameters...",
                    fontSize = 16.sp,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.TextAlign.Center
                )
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 24.dp))
                androidx.compose.material3.ProgressIndicator(
                    modifier = androidx.compose.ui.Modifier.size(48.dp)
                )
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = 16.dp))
                androidx.compose.material3.Text(
                    text = status,
                    fontSize = 14.sp,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

// Re-export screens from other files
@Composable
fun SendScreen(viewModel: WalletViewModel, onBack: () -> Unit) {
    com.kovanica.lightnode.ui.SendScreen(viewModel, onBack)
}

@Composable
fun ReceiveScreen(onBack: () -> Unit) {
    com.kovanica.lightnode.ui.ReceiveScreen(onBack)
}

@Composable
fun HistoryScreen(onBack: () -> Unit) {
    com.kovanica.lightnode.ui.HistoryScreen(onBack)
}

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    com.kovanica.lightnode.ui.SettingsScreen(onBack)
}