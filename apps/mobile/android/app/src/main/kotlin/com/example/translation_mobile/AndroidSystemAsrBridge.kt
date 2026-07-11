package com.example.translation_mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

class AndroidSystemAsrBridge(private val activity: FlutterActivity) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var eventSink: EventChannel.EventSink? = null
    private var pendingPermissionResult: MethodChannel.Result? = null
    private var running = false
    private var currentLanguage = "auto"
    private var sequence = 0

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
            handleMethodCall(call, result)
        }
        EventChannel(messenger, EVENT_CHANNEL).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                eventSink = events
            }

            override fun onCancel(arguments: Any?) {
                eventSink = null
            }
        })
    }

    fun onRequestPermissionsResult(
        requestCode: Int,
        grantResults: IntArray
    ): Boolean {
        if (requestCode != REQUEST_RECORD_AUDIO) return false
        val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        pendingPermissionResult?.success(granted)
        pendingPermissionResult = null
        return true
    }

    fun destroy() {
        stopRecognition()
        eventSink = null
        pendingPermissionResult = null
    }

    private fun handleMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isAvailable" -> result.success(availability())
            "requestPermission" -> requestPermission(result)
            "start" -> startRecognition(call.argument<String>("language"), result)
            "stop" -> {
                stopRecognition()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun availability(): Map<String, Any?> {
        val available = SpeechRecognizer.isRecognitionAvailable(activity)
        return mapOf(
            "provider" to "android_system_asr",
            "available" to available,
            "reason" to if (available) "ready" else "system_asr_unavailable",
            "microphone" to mapOf("permission" to permissionStatus())
        )
    }

    private fun requestPermission(result: MethodChannel.Result) {
        if (hasRecordAudioPermission()) {
            result.success(true)
            return
        }
        pendingPermissionResult = result
        activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
    }

    private fun startRecognition(rawLanguage: String?, result: MethodChannel.Result) {
        if (!hasRecordAudioPermission()) {
            result.error(
                "microphone_permission_denied",
                "Microphone permission is required for device ASR.",
                null
            )
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            result.error(
                "system_asr_unavailable",
                "Android system speech recognition is unavailable.",
                availability()
            )
            return
        }
        currentLanguage = normalizeLanguage(rawLanguage)
        running = true
        ensureRecognizer()
        beginListening()
        result.success(null)
    }

    private fun stopRecognition() {
        running = false
        mainHandler.removeCallbacksAndMessages(null)
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
    }

    private fun ensureRecognizer() {
        if (recognizer != null) return
        recognizer = SpeechRecognizer.createSpeechRecognizer(activity).also {
            it.setRecognitionListener(listener)
        }
    }

    private fun beginListening() {
        val activeRecognizer = recognizer ?: return
        try {
            activeRecognizer.cancel()
            activeRecognizer.startListening(recognizerIntent())
        } catch (error: RuntimeException) {
            emitState("system_asr_error", error.localizedMessage ?: "startListening failed")
            scheduleRestart()
        }
    }

    private fun scheduleRestart() {
        if (!running) return
        mainHandler.postDelayed({
            if (!running) return@postDelayed
            ensureRecognizer()
            beginListening()
        }, RESTART_DELAY_MS)
    }

    private fun recognizerIntent(): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            languageTag(currentLanguage)?.let {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, it)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, it)
            }
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        override fun onPartialResults(partialResults: Bundle?) {
            emitResult(partialResults, isFinal = false)
        }

        override fun onResults(results: Bundle?) {
            emitResult(results, isFinal = true)
            scheduleRestart()
        }

        override fun onError(error: Int) {
            emitState("system_asr_error", errorName(error))
            if (running) scheduleRestart()
        }
    }

    private fun emitResult(bundle: Bundle?, isFinal: Boolean) {
        val text = bundle
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()
        if (text.isEmpty()) return
        val confidence = bundle
            ?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
            ?.firstOrNull()
            ?.takeIf { it >= 0.0f }
            ?.toDouble()
        if (isFinal) sequence += 1
        eventSink?.success(
            mutableMapOf<String, Any?>(
                "id" to if (isFinal) "android_system_$sequence" else "android_system_partial",
                "text" to text,
                "language" to currentLanguage,
                "isFinal" to isFinal
            ).apply {
                if (confidence != null) put("confidence", confidence)
            }
        )
    }

    private fun emitState(type: String, message: String) {
        eventSink?.success(
            mapOf(
                "type" to type,
                "message" to message,
                "provider" to "android_system_asr"
            )
        )
    }

    private fun hasRecordAudioPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun permissionStatus(): String {
        return if (hasRecordAudioPermission()) "granted" else "denied"
    }

    private fun normalizeLanguage(value: String?): String {
        val normalized = value?.trim()?.lowercase(Locale.US).orEmpty()
        return when {
            normalized.startsWith("zh") || normalized.startsWith("cmn") -> "zh"
            normalized.startsWith("en") -> "en"
            else -> "auto"
        }
    }

    private fun languageTag(language: String): String? {
        return when (language) {
            "zh" -> "zh-CN"
            "en" -> "en-US"
            else -> null
        }
    }

    private fun errorName(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "audio"
            SpeechRecognizer.ERROR_CLIENT -> "client"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "insufficient_permissions"
            SpeechRecognizer.ERROR_NETWORK -> "network"
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network_timeout"
            SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer_busy"
            SpeechRecognizer.ERROR_SERVER -> "server"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speech_timeout"
            else -> "unknown_$error"
        }
    }

    companion object {
        private const val METHOD_CHANNEL = "translation_mobile/system_asr"
        private const val EVENT_CHANNEL = "translation_mobile/system_asr/events"
        private const val REQUEST_RECORD_AUDIO = 9107
        private const val RESTART_DELAY_MS = 180L
    }
}
