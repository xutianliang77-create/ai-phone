package com.example.translation_mobile

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.nl.translate.Translation
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Device-only ML Kit translation bridge.  It never uses the network-backed
 * translation API: callers must explicitly prepare both language models before
 * `translate` is allowed to invoke the local Translator.
 */
class AndroidOnDeviceTranslationBridge {
    private val translators = mutableMapOf<String, Translator>()
    private val modelManager = RemoteModelManager.getInstance()
    private var preparationGeneration = 0

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "isAvailable" -> availability(call, result)
                "translate" -> translate(call, result)
                "prepare" -> prepare(call, result)
                "cancelPreparation" -> {
                    // ML Kit exposes no operation-level cancellation for model
                    // downloads.  Stop waiting for this app request; a system
                    // download that has already started is neither claimed as
                    // cancelled nor deleted.
                    preparationGeneration += 1
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    fun destroy() {
        preparationGeneration += 1
        translators.values.forEach { it.close() }
        translators.clear()
    }

    private fun availability(call: MethodCall, result: MethodChannel.Result) {
        val pair = languagePair(call)
        if (pair == null) {
            result.success(unavailable(call, "unsupported_language_pair"))
            return
        }
        downloaded(pair, { installed ->
            result.success(
                mapOf(
                    "available" to installed,
                    "provider" to "android_mlkit",
                    "sourceLanguage" to pair.source,
                    "targetLanguage" to pair.target,
                    "status" to if (installed) "installed" else "missing",
                    "reason" to if (installed) "ready" else "language_pair_not_installed"
                )
            )
        }, { error ->
            result.error("translation_model_inventory_failed", error.message, null)
        })
    }

    private fun prepare(call: MethodCall, result: MethodChannel.Result) {
        if (call.argument<Boolean>("downloadAuthorized") != true) {
            result.error("translation_download_not_authorized", "Explicit resource preparation is required.", null)
            return
        }
        val pair = languagePair(call)
        if (pair == null) {
            result.error("unsupported_language_pair", "Unsupported on-device translation language pair.", null)
            return
        }
        val generation = ++preparationGeneration
        downloaded(pair, { installed ->
            if (generation != preparationGeneration) return@downloaded
            if (installed) {
                result.success(null)
                return@downloaded
            }
            // Deliberately require Wi-Fi for an explicit user resource action.
            // `translate` never calls this method or downloads a model itself.
            val conditions = DownloadConditions.Builder().requireWifi().build()
            download(
                pair.sourceModel,
                conditions,
                success = {
                    if (generation == preparationGeneration) {
                        download(
                            pair.targetModel,
                            conditions,
                            success = {
                                if (generation == preparationGeneration) result.success(null)
                            },
                            failure = { error ->
                                if (generation == preparationGeneration) {
                                    result.error("translation_model_download_failed", error.message, null)
                                }
                            }
                        )
                    }
                },
                failure = { error ->
                    if (generation == preparationGeneration) {
                        result.error("translation_model_download_failed", error.message, null)
                    }
                }
            )
        }, { error ->
            if (generation == preparationGeneration) {
                result.error("translation_model_inventory_failed", error.message, null)
            }
        })
    }

    private fun translate(call: MethodCall, result: MethodChannel.Result) {
        val text = call.argument<String>("text")?.trim().orEmpty()
        if (text.isEmpty()) {
            result.error("nothing_to_translate", "No text was provided for translation.", null)
            return
        }
        val pair = languagePair(call)
        if (pair == null) {
            result.error("unsupported_language_pair", "Unsupported on-device translation language pair.", null)
            return
        }
        downloaded(pair, { installed ->
            if (!installed) {
                result.error("language_pair_not_installed", "The requested on-device translation resources are not ready.", pair.payload())
                return@downloaded
            }
            translator(pair).translate(text)
                .addOnSuccessListener { translated ->
                    val normalized = translated.trim()
                    if (normalized.isEmpty) {
                        result.error("empty_translation", "Android ML Kit returned empty text.", pair.payload())
                    } else {
                        result.success(pair.payload() + mapOf(
                            "text" to normalized,
                            "provider" to "android_mlkit"
                        ))
                    }
                }
                .addOnFailureListener { error ->
                    result.error("on_device_translation_failed", error.message, pair.payload())
                }
        }, { error ->
            result.error("translation_model_inventory_failed", error.message, null)
        })
    }

    private fun translator(pair: TranslationPair): Translator {
        return translators.getOrPut(pair.key) {
            Translation.getClient(
                TranslatorOptions.Builder()
                    .setSourceLanguage(pair.source)
                    .setTargetLanguage(pair.target)
                    .build()
            )
        }
    }

    private fun downloaded(
        pair: TranslationPair,
        success: (Boolean) -> Unit,
        failure: (Exception) -> Unit
    ) {
        modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
            .addOnSuccessListener { models ->
                val languages = models.map { it.language }.toSet()
                success(languages.contains(pair.source) && languages.contains(pair.target))
            }
            .addOnFailureListener { error -> failure(error) }
    }

    private fun download(
        model: TranslateRemoteModel,
        conditions: DownloadConditions,
        success: () -> Unit,
        failure: (Exception) -> Unit
    ) {
        modelManager.download(model, conditions)
            .addOnSuccessListener { success() }
            .addOnFailureListener { error -> failure(error) }
    }

    private fun languagePair(call: MethodCall): TranslationPair? {
        val source = TranslateLanguage.fromLanguageTag(call.argument<String>("sourceLanguage") ?: return null)
        val target = TranslateLanguage.fromLanguageTag(call.argument<String>("targetLanguage") ?: return null)
        if (source == null || target == null || source == target) return null
        return TranslationPair(source, target)
    }

    private fun unavailable(call: MethodCall, reason: String) = mapOf(
        "available" to false,
        "provider" to "android_mlkit",
        "sourceLanguage" to (call.argument<String>("sourceLanguage") ?: ""),
        "targetLanguage" to (call.argument<String>("targetLanguage") ?: ""),
        "reason" to reason
    )

    private data class TranslationPair(val source: String, val target: String) {
        val key get() = "$source:$target"
        val sourceModel get() = TranslateRemoteModel.Builder(source).build()
        val targetModel get() = TranslateRemoteModel.Builder(target).build()
        fun payload() = mapOf("sourceLanguage" to source, "targetLanguage" to target)
    }

    companion object {
        private const val METHOD_CHANNEL = "translation_mobile/android_on_device_translation"
    }
}
