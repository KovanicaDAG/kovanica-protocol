package com.kovanica.lightnode.data

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed encrypted storage for the BIP39 mnemonic.
 *
 * The mnemonic is encrypted with AES/GCM using a key that never leaves the
 * Android Keystore. Only the IV + ciphertext are persisted in plain
 * SharedPreferences; the plaintext lives only in memory during use.
 *
 * This slice adds optional hardening:
 *  - StrongBox-backed keys when the device supports a secure element (API 28+),
 *    falling back to TEE-backed keys automatically.
 *  - Biometric user-authentication for the key when requested and available
 *    (API 30+), falling back to a non-biometric key.
 */
class SecureSeedStorage(context: Context) {

    private val context: Context = context.applicationContext
    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    /**
     * True if the device has a StrongBox-backed Keystore secure element.
     */
    fun isStrongBoxAvailable(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
    }

    /**
     * True if strong biometric authentication (Class 3) is available.
     */
    fun isBiometricAvailable(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            BiometricManager.from(context)
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Encrypt and persist [mnemonic]. Overwrites any previously stored value.
     *
     * @param requireBiometric if true, attempt to create a key that requires
     *   biometric authentication before decryption. Falls back to a plain
     *   Keystore key if biometric authentication is unavailable. The actual
     *   biometric prompt is intentionally not wired in this slice to keep the
     *   existing UI unchanged.
     */
    fun saveMnemonic(mnemonic: String, requireBiometric: Boolean = false) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(requireBiometric = requireBiometric))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(mnemonic.toByteArray(Charsets.UTF_8))

        prefs.edit()
            .putString(KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .putString(KEY_CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .apply()
    }

    /**
     * Decrypt and return the stored mnemonic, or null if nothing is stored or
     * decryption fails (e.g. after a backup restore that invalidated the key,
     * or if the key requires biometric authentication that has not yet been
     * performed).
     */
    fun loadMnemonic(): String? {
        val ivB64 = prefs.getString(KEY_IV, null) ?: return null
        val ctB64 = prefs.getString(KEY_CIPHERTEXT, null) ?: return null

        return try {
            val iv = Base64.decode(ivB64, Base64.NO_WRAP)
            val ciphertext = Base64.decode(ctB64, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Remove the stored ciphertext. The Keystore key is intentionally left in
     * place so the same key can decrypt earlier backups if needed.
     */
    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun getOrCreateKey(requireBiometric: Boolean = false): SecretKey {
        keyStore.getKey(KEY_ALIAS, null)?.let { return it as SecretKey }

        val strongBox = isStrongBoxAvailable()
        return try {
            generateKey(buildSpec(useStrongBox = strongBox, requireBiometric = requireBiometric))
        } catch (e: Exception) {
            // StrongBox key generation can fail on some devices despite the
            // feature flag (full secure element, keymint errors, etc.). Fall
            // back to a TEE-backed key and keep the app usable.
            if (strongBox) {
                generateKey(buildSpec(useStrongBox = false, requireBiometric = requireBiometric))
            } else {
                throw e
            }
        }
    }

    private fun getKey(): SecretKey {
        return keyStore.getKey(KEY_ALIAS, null) as? SecretKey
            ?: throw IllegalStateException("Keystore seed key not found")
    }

    private fun buildSpec(useStrongBox: Boolean, requireBiometric: Boolean): KeyGenParameterSpec {
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && useStrongBox) {
            builder.setIsStrongBoxBacked(true)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            requireBiometric &&
            isBiometricAvailable()
        ) {
            builder.setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG,
                    0,
                )
                .setInvalidatedByBiometricEnrollment(true)
        }

        return builder.build()
    }

    private fun generateKey(spec: KeyGenParameterSpec): SecretKey {
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        generator.init(spec)
        return generator.generateKey()
    }

    companion object {
        private const val PREFS_NAME = "kovanica_secure_seed"
        private const val KEY_ALIAS = "kovanica_seed_key"
        private const val KEY_IV = "seed_iv"
        private const val KEY_CIPHERTEXT = "seed_ciphertext"
    }
}
