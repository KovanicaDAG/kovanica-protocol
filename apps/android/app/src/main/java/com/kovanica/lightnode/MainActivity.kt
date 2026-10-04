package com.kovanica.lightnode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.kovanica.lightnode.ui.WalletViewModel
import com.kovanica.lightnode.ui.navigation.AppDestinations
import com.kovanica.lightnode.ui.screens.CoinJoinScreen
import com.kovanica.lightnode.ui.screens.HistoryScreen
import com.kovanica.lightnode.ui.screens.OnboardingScreen
import com.kovanica.lightnode.ui.screens.ReceiveScreen
import com.kovanica.lightnode.ui.screens.SendScreen
import com.kovanica.lightnode.ui.screens.SettingsScreen
import com.kovanica.lightnode.ui.screens.StakingScreen
import com.kovanica.lightnode.ui.screens.WalletHomeScreen
import com.kovanica.lightnode.ui.theme.KovanicaLightNodeTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            KovanicaLightNodeTheme {
                val navController = rememberNavController()
                val viewModel: WalletViewModel = viewModel()

                NavHost(
                    navController = navController,
                    startDestination = AppDestinations.Onboarding.route,
                ) {
                    composable(AppDestinations.Onboarding.route) {
                        OnboardingScreen(
                            viewModel = viewModel,
                            onWalletReady = {
                                navController.navigate(AppDestinations.Home.route) {
                                    popUpTo(AppDestinations.Onboarding.route) {
                                        inclusive = true
                                    }
                                }
                            },
                        )
                    }
                    composable(AppDestinations.Home.route) {
                        WalletHomeScreen(
                            viewModel = viewModel,
                            onSend = { navController.navigate(AppDestinations.Send.route) },
                            onReceive = { navController.navigate(AppDestinations.Receive.route) },
                            onHistory = { navController.navigate(AppDestinations.History.route) },
                            onStake = { navController.navigate(AppDestinations.Staking.route) },
                            onCoinJoin = { navController.navigate(AppDestinations.CoinJoin.route) },
                            onSettings = { navController.navigate(AppDestinations.Settings.route) },
                        )
                    }
                    composable(AppDestinations.History.route) {
                        HistoryScreen(
                            viewModel = viewModel,
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(AppDestinations.Send.route) {
                        SendScreen(
                            viewModel = viewModel,
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(AppDestinations.Receive.route) {
                        ReceiveScreen(
                            viewModel = viewModel,
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(AppDestinations.Staking.route) {
                        StakingScreen(
                            viewModel = viewModel,
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(AppDestinations.Settings.route) {
                        SettingsScreen(
                            viewModel = viewModel,
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(AppDestinations.CoinJoin.route) {
                        CoinJoinScreen(
                            viewModel = viewModel,
                            onBack = { navController.popBackStack() },
                        )
                    }
                }
            }
        }
    }
}
