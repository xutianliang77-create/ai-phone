package com.example.translation_mobile

import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.speech.tts.TextToSpeech
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.util.Locale

class MainActivity : FlutterActivity() {
    private var textToSpeech: TextToSpeech? = null
    private var textToSpeechReady = false
    private val systemAsrBridge = AndroidSystemAsrBridge(this)
    private val pcmAudioOutputBridge = PcmAudioOutputBridge(this)

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        systemAsrBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        pcmAudioOutputBridge.register(flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "translation_mobile/speech_output"
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "speak" -> speak(call.argument("text"), call.argument("language"), result)
                "stop" -> {
                    textToSpeech?.stop()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "translation_mobile/ocr"
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "recognizeImage" -> recognizeImage(
                    call.argument<String>("imagePath"),
                    call.argument<List<String>>("scripts"),
                    result
                )
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (systemAsrBridge.onRequestPermissionsResult(requestCode, grantResults)) return
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onDestroy() {
        systemAsrBridge.destroy()
        pcmAudioOutputBridge.destroy()
        textToSpeech?.shutdown()
        textToSpeech = null
        super.onDestroy()
    }

    private fun speak(text: String?, rawLanguage: String?, result: MethodChannel.Result) {
        val trimmed = text?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            result.error("nothing_to_speak", "No text was provided for speech output.", null)
            return
        }
        val language = normalizeLanguage(rawLanguage)
        ensureTextToSpeech(
            onReady = { engine ->
                engine.language = Locale.forLanguageTag(languageTag(language))
                engine.speak(
                    trimmed,
                    TextToSpeech.QUEUE_ADD,
                    null,
                    "type_to_speak_${System.currentTimeMillis()}"
                )
                result.success(mapOf("provider" to "android_system_tts", "language" to language))
            },
            onError = {
                result.error("text_to_speech_unavailable", "Android TextToSpeech is unavailable.", null)
            }
        )
    }

    private fun ensureTextToSpeech(
        onReady: (TextToSpeech) -> Unit,
        onError: () -> Unit
    ) {
        val current = textToSpeech
        if (current != null && textToSpeechReady) {
            onReady(current)
            return
        }
        textToSpeech = TextToSpeech(this) { status ->
            val engine = textToSpeech
            if (status == TextToSpeech.SUCCESS && engine != null) {
                textToSpeechReady = true
                onReady(engine)
            } else {
                textToSpeechReady = false
                onError()
            }
        }
    }

    private fun normalizeLanguage(value: String?): String {
        val normalized = value?.trim()?.lowercase(Locale.US).orEmpty()
        return when {
            normalized.startsWith("zh") || normalized.startsWith("cmn") -> "zh"
            normalized.startsWith("en") -> "en"
            else -> "en"
        }
    }

    private fun languageTag(language: String): String {
        return if (language == "zh") "zh-CN" else "en-US"
    }

    private fun recognizeImage(
        imagePath: String?,
        rawScripts: List<String>?,
        result: MethodChannel.Result
    ) {
        val path = imagePath?.trim().orEmpty()
        if (path.isEmpty()) {
            result.error("ocr_missing_image", "No image path was provided.", null)
            return
        }
        val image = try {
            InputImage.fromFilePath(this, Uri.fromFile(File(path)))
        } catch (error: Exception) {
            result.error("ocr_invalid_image", error.localizedMessage, null)
            return
        }
        val scripts = rawScripts?.filter { it == "chinese" || it == "latin" }
            ?.takeIf { it.isNotEmpty() }
            ?: listOf("chinese", "latin")
        val texts = mutableListOf<String>()
        val usedScripts = mutableListOf<String>()
        recognizeScript(image, scripts, 0, texts, usedScripts, result)
    }

    private fun recognizeScript(
        image: InputImage,
        scripts: List<String>,
        index: Int,
        texts: MutableList<String>,
        usedScripts: MutableList<String>,
        result: MethodChannel.Result
    ) {
        if (index >= scripts.size) {
            result.success(
                mapOf(
                    "text" to texts.joinToString("\n\n"),
                    "provider" to "android_mlkit",
                    "scripts" to usedScripts
                )
            )
            return
        }

        val script = scripts[index]
        val recognizer = if (script == "latin") {
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        } else {
            TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        }
        recognizer.process(image)
            .addOnSuccessListener { recognizedText ->
                val text = normalizeOcrText(recognizedText.text)
                if (text.isNotEmpty()) mergeOcrText(texts, text)
                usedScripts.add(script)
                recognizer.close()
                recognizeScript(image, scripts, index + 1, texts, usedScripts, result)
            }
            .addOnFailureListener { error ->
                recognizer.close()
                result.error("ocr_failed", error.localizedMessage, null)
            }
    }

    private fun mergeOcrText(texts: MutableList<String>, next: String) {
        for (index in texts.indices) {
            val current = texts[index]
            if (compactOcrText(current) == compactOcrText(next) || current.contains(next)) return
            if (next.contains(current)) {
                texts[index] = next
                return
            }
        }
        texts.add(next)
    }

    private fun normalizeOcrText(text: String): String {
        return text.lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
            .trim()
    }

    private fun compactOcrText(text: String): String {
        return text.replace(Regex("\\s+"), "").lowercase(Locale.US)
    }
}
