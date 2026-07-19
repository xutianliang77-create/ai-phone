package com.example.translation_mobile

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

class AndroidSpeechOutputBridge(
    private val activity: FlutterActivity,
    private val audioSessionCoordinator: AudioSessionCoordinator
) {
    private val audioSessionOwner = "system_tts"
    private var textToSpeech: TextToSpeech? = null
    private var textToSpeechReady = false
    private var pendingResult: MethodChannel.Result? = null
    private var pendingUtteranceId: String? = null
    private var pendingLanguage = "en"

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, "translation_mobile/speech_output")
            .setMethodCallHandler(::handle)
    }

    fun destroy() {
        stopCurrent()
        textToSpeech?.shutdown()
        textToSpeech = null
        textToSpeechReady = false
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "speak" -> speak(call.argument("text"), call.argument("language"), result)
            "stop" -> {
                stopCurrent()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun speak(text: String?, rawLanguage: String?, result: MethodChannel.Result) {
        val trimmed = text?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            result.error("nothing_to_speak", "No text was provided for speech output.", null)
            return
        }
        stopCurrent()
        try {
            audioSessionCoordinator.beginPlayback(audioSessionOwner)
        } catch (error: RuntimeException) {
            result.error("audio_session_unavailable", error.localizedMessage, null)
            return
        }
        val language = normalizeLanguage(rawLanguage)
        val utteranceId = "speech_${System.currentTimeMillis()}"
        pendingResult = result
        pendingUtteranceId = utteranceId
        pendingLanguage = language
        ensureTextToSpeech(
            onReady = { engine ->
                if (pendingUtteranceId != utteranceId) return@ensureTextToSpeech
                engine.language = Locale.forLanguageTag(languageTag(language))
                val status = engine.speak(
                    trimmed,
                    TextToSpeech.QUEUE_FLUSH,
                    null,
                    utteranceId
                )
                if (status == TextToSpeech.ERROR) finishError(utteranceId)
            },
            onError = { finishError(utteranceId) }
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
        textToSpeech = TextToSpeech(activity) { status ->
            val engine = textToSpeech
            if (status == TextToSpeech.SUCCESS && engine != null) {
                textToSpeechReady = true
                engine.setOnUtteranceProgressListener(listener)
                onReady(engine)
            } else {
                textToSpeechReady = false
                onError()
            }
        }
    }

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit

        override fun onDone(utteranceId: String?) {
            activity.runOnUiThread { finishSuccess(utteranceId) }
        }

        @Deprecated("Deprecated in Android")
        override fun onError(utteranceId: String?) {
            activity.runOnUiThread { finishError(utteranceId) }
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            activity.runOnUiThread { finishError(utteranceId) }
        }
    }

    private fun stopCurrent() {
        textToSpeech?.stop()
        finishSuccess(pendingUtteranceId)
    }

    private fun finishSuccess(utteranceId: String?) {
        if (utteranceId == null || utteranceId != pendingUtteranceId) return
        val result = pendingResult
        clearPending()
        result?.success(
            mapOf("provider" to "android_system_tts", "language" to pendingLanguage)
        )
    }

    private fun finishError(utteranceId: String?) {
        if (utteranceId == null || utteranceId != pendingUtteranceId) return
        val result = pendingResult
        clearPending()
        result?.error(
            "text_to_speech_unavailable",
            "Android TextToSpeech is unavailable.",
            null
        )
    }

    private fun clearPending() {
        pendingResult = null
        pendingUtteranceId = null
        audioSessionCoordinator.endPlayback(audioSessionOwner)
    }

    private fun normalizeLanguage(value: String?): String {
        val normalized = value?.trim()?.lowercase(Locale.US).orEmpty()
        return when {
            normalized.startsWith("zh") || normalized.startsWith("cmn") -> "zh"
            else -> "en"
        }
    }

    private fun languageTag(language: String) = if (language == "zh") "zh-CN" else "en-US"
}
