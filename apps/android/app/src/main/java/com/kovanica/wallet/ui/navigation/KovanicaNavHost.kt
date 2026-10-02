package com.kovanica.wallet.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.kovanica.wallet.ui.screens.HomeScreen
import com.kovanica.wallet.ui.screens.SendScreen
import com.kovanica.wallet.ui.screens.ReceiveScreen
import com.kovanica.wallet.ui.screens.SettingsScreen
import com.kovanica.wallet.ui.screens.WalletSetupScreen

sealed class Screen(val route: String) {
    object Home : Screen("home")
    object Send : Screen("send")
    object Receive : Screen("receive")
    object Settings : Screen("settings")
    object WalletSetup : Screen("wallet_setup")
}

@Composable
fun KovanicaNavHost(
    navController: NavHostController = rememberNavController()
) {
    NavHost(
        navController = navController,
        startDestination = Screen.WalletSetup.route
    ) {
        composable(Screen.WalletSetup.route) {
            WalletSetupScreen(
                onWalletReady = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.WalletSetup.route) { inclusive = true }
                    }
                }
            )
        }
        composable(Screen.Home.route) {
            HomeScreen(
                onNavigateToSend = { navController.navigate(Screen.Send.route) },
                onNavigateToReceive = { navController.navigate(Screen.Receive.route) },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) }
            )
        }
        composable(Screen.Send.route) {
            SendScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
        composable(Screen.Receive.route) {
            ReceiveScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}