pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    // Composite builds share one buildscript classpath, so all AGP / Kotlin
    // plugin ids resolve to a single version — the included :kovanica-ffi
    // module declares its plugins without a version and inherits these.
    resolutionStrategy.eachPlugin {
        when (requested.id.id) {
            "com.android.application",
            "com.android.library" -> useVersion(libs.versions.agp.get())
            "org.jetbrains.kotlin.android" -> useVersion(libs.versions.kotlin.get())
        }
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "kovanica-light-node"

include(":app")
// Project-dir link to the committed FFI Gradle module (AAR packaging lives
// in crates/kovanica-ffi/android; build-android.sh lays the .so files into
// jniLibs before assemble). Swap to a published AAR in the release slice.
include(":kovanica-ffi")
project(":kovanica-ffi").projectDir = file("../crates/kovanica-ffi/android")