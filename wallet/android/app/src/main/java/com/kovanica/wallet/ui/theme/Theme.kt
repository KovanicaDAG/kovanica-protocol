package com.kovanica.wallet.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = KvncGold,
    onPrimary = Obsidian,
    primaryContainer = KvncGoldDim,
    onPrimaryContainer = WarmOffWhite,
    secondary = WarmOffWhite,
    onSecondary = Obsidian,
    secondaryContainer = Graphite,
    onSecondaryContainer = WarmOffWhite,
    background = Obsidian,
    onBackground = WarmOffWhite,
    surface = Ink,
    onSurface = WarmOffWhite,
    surfaceVariant = Graphite,
    onSurfaceVariant = Muted,
    outline = Stone,
    error = ErrorRed,
    onError = WarmOffWhite,
)

private val LightColorScheme = lightColorScheme(
    primary = KvncGold,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = KvncGoldDim,
    onPrimaryContainer = Color(0xFFFFFFFF),
    secondary = Obsidian,
    onSecondary = WarmOffWhite,
    secondaryContainer = Stone,
    onSecondaryContainer = Obsidian,
    background = Color(0xFFF5F5F4),
    onBackground = Obsidian,
    surface = Color(0xFFFFFFFF),
    onSurface = Obsidian,
    surfaceVariant = Color(0xFFE6E4E0),
    onSurfaceVariant = Color(0xFF4B5563),
    outline = Color(0xFFD1D5DB),
    error = ErrorRed,
    onError = Color(0xFFFFFFFF),
)

private val KovanicaTypography = Typography()

@Composable
fun KovanicaWalletTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = KovanicaTypography,
        content = content,
    )
}
