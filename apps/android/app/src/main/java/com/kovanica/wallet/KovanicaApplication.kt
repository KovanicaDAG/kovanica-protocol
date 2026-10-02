package com.kovanica.wallet

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kovanica.LightNode
import kovanica.LightConfig

class KovanicaApplication : Application() {
    companion object {
        private const val TAG = "KovanicaApplication"
    }

    private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "kovanica_preferences")

    private val _lightNode = MutableStateFlow<LightNode?>(null)
    val lightNode: StateFlow<LightNode?> = _lightNode

    fun initializeLightNode(config: LightConfig): LightNode {
        val node = LightNode(config)
        _lightNode.value = node
        return node
    }

    suspend fun getLightNode(): LightNode = _lightNode.first { it != null }!!

    fun savePreferenceString(key: String, value: String) {
        CoroutineScope(Dispatchers.IO).launch {
            applicationContext.dataStore.edit { prefs ->
                prefs[stringPreferencesKey(key)] = value
            }
        }
    }

    suspend fun getPreferenceString(key: String, default: String): String = withContext(Dispatchers.IO) {
        val prefKey = stringPreferencesKey(key)
        applicationContext.dataStore.data.first()[prefKey] ?: default
    }

    fun clearLightNode() {
        _lightNode.value = null
    }
}