plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kovanica.uniffi"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    // Single committed home for the UniFFI Kotlin bindings: the generated file
    // lives in the Rust crate that owns the interface
    // (`protocol/crates/kovanica-ffi/bindings/kotlin`), and this module compiles
    // it straight from there. `ci.yml` regenerates the file and fails the build
    // if it drifts, so there is nothing to keep in sync by hand.
    sourceSets {
        getByName("main") {
            java.srcDir("../../../protocol/crates/kovanica-ffi/bindings/kotlin")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
        freeCompilerArgs += "-Xopt-in=kotlin.RequiresOptIn"
    }


}

dependencies {
    // JNA for native library loading
    implementation("net.java.dev.jna:jna:5.13.0")
}