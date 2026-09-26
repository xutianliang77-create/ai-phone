import java.io.File
import java.util.Base64
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

// Reuse the original application and native package. Public identity/signing
// is an explicit build input, never inherited from the private key.properties.
val candidateDefines = mutableMapOf<String, String>()
(project.findProperty("dart-defines") as? String)?.split(",")
    ?.filter { it.isNotEmpty() }?.forEach { encoded ->
        val decoded = String(Base64.getDecoder().decode(encoded), Charsets.UTF_8)
        val separator = decoded.indexOf('=')
        require(separator > 0) { "Invalid Dart build define" }
        val name = decoded.substring(0, separator)
        require(!candidateDefines.containsKey(name)) { "Duplicate Dart build define: $name" }
        candidateDefines[name] = decoded.substring(separator + 1)
    }
val publicBuildDeclaration = System.getenv("PUBLIC_ANDROID_BUILD")
require(publicBuildDeclaration == null || publicBuildDeclaration in listOf("true", "false")) {
    "PUBLIC_ANDROID_BUILD must be true or false"
}
val publicCandidate = !candidateDefines["PUBLIC_DEPLOYMENT_ID"].isNullOrEmpty() ||
    publicBuildDeclaration == "true" || System.getenv().any { (name, value) ->
        name.startsWith("PUBLIC_ANDROID_") && name != "PUBLIC_ANDROID_BUILD" && value.isNotEmpty()
    }
val publicProperties = Properties().apply {
    if (publicCandidate) {
        val candidateFile = rootProject.file(
            System.getenv("PUBLIC_ANDROID_KEY_PROPERTIES") ?: "public-key.properties"
        )
        require(candidateFile.canonicalFile != rootProject.file("key.properties").canonicalFile) {
            "Public signing configuration must not reuse private key.properties"
        }
        if (candidateFile.exists()) candidateFile.inputStream().use { load(it) }
    }
}
fun publicSetting(name: String): String? {
    val envName = releaseEnvName(name).replace("TRANSLATION_ANDROID_", "PUBLIC_ANDROID_")
    return (System.getenv(envName) ?: publicProperties.getProperty(name))
        ?.takeIf { it.isNotBlank() }
}
val publicApplicationId = publicSetting("applicationId")
val publicStoreFile = publicSetting("storeFile")
val publicSigningReady = listOf(publicStoreFile, publicSetting("storePassword"),
    publicSetting("keyAlias"), publicSetting("keyPassword")).all { it != null }
if (publicCandidate) {
    require(publicApplicationId != null &&
        Regex("[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*){2,}").matches(publicApplicationId) &&
        !publicApplicationId.startsWith("com.example.") &&
        !publicApplicationId.startsWith("com.yourcompany.") &&
        publicApplicationId != "com.wujieai.androidtest" &&
        publicApplicationId != releaseOptionalString("applicationId")) {
        "Public Android applicationId must be approved, non-template and distinct from private/test identity"
    }
    require(publicSigningReady && rootProject.file(requireNotNull(publicStoreFile)).isFile) {
        "Public Android candidate requires its own existing signing material"
    }
    val requiredProfile = mapOf(
        "USE_DEVICE_ASR" to "true", "DEVICE_ASR_PROVIDER" to "android_system",
        "USE_ON_DEVICE_TRANSLATION" to "true", "ON_DEVICE_TRANSLATION_PROVIDER" to "android_mlkit",
        "ON_DEVICE_TRANSLATION_REQUIRED" to "true", "USE_LOCAL_SESSIONS" to "true",
        "SERVER_OWNED_HISTORY" to "false", "DEVICE_ASR_VAD_PROVIDER" to "silero_onnx",
        "DEVICE_ASR_AUTO_DOWNLOAD_MODEL" to "false", "DEVICE_ASR_DIAGNOSTIC_CAPTURE" to "false",
        "USE_MOCK_AUDIO" to "false",
        "ENABLE_DEVICE_SPEAKER" to "false", "WUJIE_PRODUCT_PROFILE" to "full",
        "SOURCE_STATE" to "clean", "APP_VERSION" to "1.1.0"
    )
    require(requiredProfile.all { (name, value) -> candidateDefines[name] == value }) {
        "Public Android candidate is missing the complete Android local/product profile"
    }
    require(listOf("SOURCE_COMMIT", "SOURCE_TREE").all {
        Regex("[a-f0-9]{40}").matches(candidateDefines[it].orEmpty())
    } && Regex("[a-f0-9]{64}").matches(candidateDefines["ANDROID_LOCAL_PROFILE_SHA256"].orEmpty()) &&
        Regex("[A-Za-z0-9._-]{1,96}").matches(candidateDefines["PUBLIC_DEPLOYMENT_ID"].orEmpty()) &&
        Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}").matches(candidateDefines["WUJIE_CANDIDATE_ID"].orEmpty())) {
        "Public Android candidate source/deployment identity is incomplete"
    }
}

android {
    namespace = if (publicCandidate) "com.example.translation_mobile"
        else releaseString("namespace", "com.example.translation_mobile")
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = if (publicCandidate) requireNotNull(publicApplicationId)
            else releaseString("applicationId", "com.example.translation_mobile")
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        if (publicCandidate) {
            require(candidateDefines["APP_VERSION"] == versionName &&
                candidateDefines["BUILD_NUMBER"] == versionCode.toString()) {
                "Public Android native and Dart version inputs must match"
            }
        }
        manifestPlaceholders.putAll(mapOf(
            "wujieCandidateId" to (candidateDefines["WUJIE_CANDIDATE_ID"] ?: "untraceable"),
            "wujieSourceCommit" to (candidateDefines["SOURCE_COMMIT"] ?: "untraceable"),
            "wujieSourceTree" to (candidateDefines["SOURCE_TREE"] ?: "untraceable"),
            "wujieSourceState" to (candidateDefines["SOURCE_STATE"] ?: "unknown"),
            "wujieProductProfile" to (candidateDefines["WUJIE_PRODUCT_PROFILE"] ?: "full"),
            "wujieDeploymentId" to (candidateDefines["PUBLIC_DEPLOYMENT_ID"] ?: "private"),
            "wujieLocalProfileSha256" to (candidateDefines["ANDROID_LOCAL_PROFILE_SHA256"] ?: "untraceable")
        ))
    }

    signingConfigs {
        create("release") {
            if (publicCandidate) {
                storeFile = rootProject.file(requireNotNull(publicStoreFile))
                storePassword = requireNotNull(publicSetting("storePassword"))
                keyAlias = requireNotNull(publicSetting("keyAlias"))
                keyPassword = requireNotNull(publicSetting("keyPassword"))
            } else if (releaseSigningReady) {
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
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (publicCandidate || releaseSigningReady) {
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
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.29.0")
    testImplementation("junit:junit:4.13.2")
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")
    implementation("com.google.mlkit:translate:17.0.3")
}
