pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOSITORIES)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "KovanicaLightNode"

include(":app")

// Link to local kovanica-ffi AAR during development
// Swap to published AAR (mavenLocal / GH artifact) in CI
val ffiAarDir = file("../protocol/crates/kovanica-ffi/android")
if (ffiAarDir.exists()) {
    include(":kovanica-ffi")
    project(":kovanica-ffi").projectDir = ffiAarDir
}