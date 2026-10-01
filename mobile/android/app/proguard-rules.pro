# Keep the generated UniFFI bindings + JNA reachable under minification.
-keep class uniffi.kovanica.** { *; }
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { *; }
-dontwarn java.awt.**
-dontwarn javax.swing.**