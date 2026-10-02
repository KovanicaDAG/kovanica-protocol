package com.kovanica.lightnode.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = KovanicaGold,
    onPrimary = Obsidian,
    primaryContainer = KovanicaGoldDark,
    onPrimaryContainer = OffWhite,
    secondary = KovanicaTeal,
    onSecondary = Obsidian,
    secondaryContainer = Graphite,
    onSecondaryContainer = OffWhite,
    background = Obsidian,
    onBackground = OffWhite,
    surface = Ink,
    onSurface = OffWhite,
    surfaceVariant = Graphite,
    onSurfaceVariant = Muted,
    outline = Stone,
    error = KovanicaRed,
    onError = OffWhite,
)

private val LightColorScheme = lightColorScheme(
    primary = KovanicaGoldDark,
    onPrimary = OffWhite,
    primaryContainer = KovanicaGold,
    onPrimaryContainer = Obsidian,
    secondary = KovanicaTeal,
    onSecondary = OffWhite,
    secondaryContainer = Stone,
    onSecondaryContainer = Obsidian,
    background = Color(0xFFF8F9FA),
    onBackground = Obsidian,
    surface = Color(0xFFFFFFFF),
    onSurface = Obsidian,
    surfaceVariant = Color(0xFFE5E7EB),
    onSurfaceVariant = Color(0xFF4B5563),
    outline = Color(0xFFD1D5DB),
    error = KovanicaRed,
    onError = OffWhite,
)

@Composable
fun KovanicaLightNodeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

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
        content = content
    )
}
