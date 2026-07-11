import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releasePropertiesFile = rootProject.file("key.properties")
val releaseProperties = Properties().apply {
    if (releasePropertiesFile.exists()) {
        releasePropertiesFile.inputStream().use { load(it) }
    }
}

fun releaseEnvName(name: String): String {
    val snakeName = name.replace(Regex("([a-z])([A-Z])")) {
        "${it.groupValues[1]}_${it.groupValues[2]}"
    }
    return "TRANSLATION_ANDROID_${snakeName.uppercase()}"
}

fun releaseOptionalString(name: String): String? {
    return (System.getenv(releaseEnvName(name)) ?: releaseProperties.getProperty(name))
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
}

fun releaseString(name: String, defaultValue: String): String {
    return releaseOptionalString(name) ?: defaultValue
}

val releaseStoreFile = releaseOptionalString("storeFile")
val releaseSigningReady = listOf(
    releaseStoreFile,
    releaseOptionalString("storePassword"),
    releaseOptionalString("keyAlias"),
    releaseOptionalString("keyPassword"),
).all { it != null }

android {
    namespace = releaseString("namespace", "com.example.translation_mobile")
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = releaseString("applicationId", "com.example.translation_mobile")
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                val storeFilePath = requireNotNull(releaseStoreFile)
                storeFile = if (File(storeFilePath).isAbsolute) {
                    file(storeFilePath)
                } else {
                    rootProject.file(storeFilePath)
                }
                storePassword = requireNotNull(releaseOptionalString("storePassword"))
                keyAlias = requireNotNull(releaseOptionalString("keyAlias"))
                keyPassword = requireNotNull(releaseOptionalString("keyPassword"))
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")
}
