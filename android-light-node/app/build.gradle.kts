plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.kovanica.lightnode"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kovanica.lightnode"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            // bcprov-jdk18on and jspecify both ship this OSGi manifest path;
            // exclude it so :app:mergeDebugJavaResource does not fail.
            excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }
}

dependencies {
    // FFI light node core — the AAR carries jniLibs .so files + generated
    // kotlin.kovanica bindings + JNA consumer rules.
    implementation(project(":kovanica-ffi"))

    // Jetpack Compose UI
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation("androidx.compose.material:material-icons-extended")
    implementation(libs.activity.compose)

    // Navigation, ViewModel, coroutines, HTTP client
    implementation(libs.navigation.compose)
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.okhttp)

    // Background sync (WorkManager), notification compat, and biometric Keystore
    implementation(libs.work.runtime.ktx)
    implementation(libs.biometric)
    implementation(libs.core.ktx)

    // Local cryptography: Ed25519 key derivation + PBKDF2 for BIP39 seed.
    // The FFI handles signing; this is only used to derive the display address.
    implementation(libs.bouncycastle)
}
