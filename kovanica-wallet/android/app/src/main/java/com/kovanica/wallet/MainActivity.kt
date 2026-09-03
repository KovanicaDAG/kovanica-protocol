package com.kovanica.wallet

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.kovanica.wallet.ui.WalletViewModel
import com.kovanica.wallet.ui.screens.HomeScreen
import com.kovanica.wallet.ui.screens.HistoryScreen
import com.kovanica.wallet.ui.screens.ReceiveScreen
import com.kovanica.wallet.ui.theme.KovanicaWalletTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KovanicaWalletTheme {
                val walletViewModel: WalletViewModel = viewModel(factory = WalletViewModel.Factory)
                WalletNavHost(walletViewModel)
            }
        }
    }
}

object Routes {
    const val HOME = "home"
    const val RECEIVE = "receive"
    const val HISTORY = "history"
}

@Composable
private fun WalletNavHost(viewModel: WalletViewModel) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                viewModel = viewModel,
                onReceive = { navController.navigate(Routes.RECEIVE) },
                onHistory = { navController.navigate(Routes.HISTORY) },
            )
        }
        composable(Routes.RECEIVE) {
            ReceiveScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.HISTORY) {
            HistoryScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
