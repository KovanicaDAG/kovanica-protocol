package com.kovanica.lightnode.ui.navigation

/**
 * Strongly-typed route names for the wallet NavHost.
 */
sealed class AppDestinations(val route: String) {
    data object Onboarding : AppDestinations("onboarding")
    data object Home : AppDestinations("home")
    data object History : AppDestinations("history")
    data object Send : AppDestinations("send")
    data object Receive : AppDestinations("receive")
    data object Staking : AppDestinations("staking")
    data object CoinJoin : AppDestinations("coinjoin")
    data object Settings : AppDestinations("settings")
}
