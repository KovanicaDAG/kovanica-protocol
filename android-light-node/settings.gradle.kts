pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
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