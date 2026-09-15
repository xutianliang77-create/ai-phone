package com.example.translation_mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

class AndroidSystemAsrBridge(
    private val activity: FlutterActivity,
    private val audioSessionCoordinator: AudioSessionCoordinator
) {
    private val audioSessionOwner = "android_system_asr"
    private val mainHandler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var eventSink: EventChannel.EventSink? = null
    private var pendingPermissionResult: MethodChannel.Result? = null
    private var running = false
    private var currentLanguage = "auto"
    private var sequence = 0
    private var activeSegmentId: String? = null
    private var activeRevision = 0
    private var captureStartedAtElapsedMs = 0L
    private var speechStartedAtElapsedMs: Long? = null
    private var captureId: String? = null
    private var languagePolicyKey: String? = null

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
            "isAvailable" -> result.success(availability(call.argument<String>("language")))
            "requestPermission" -> requestPermission(result)
            "start" -> startRecognition(
                call.argument<String>("language"),
                call.argument<String>("captureId"),
                call.argument<String>("languagePolicyKey"),
                result
            )
            "stop" -> {
                stopRecognition()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun availability(rawLanguage: String? = null): Map<String, Any?> {
        val language = normalizeLanguage(rawLanguage)
        val apiSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
        val available = apiSupported && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
        return mapOf(
            "provider" to "android_system_asr",
            "available" to available,
            "reason" to when {
                available -> "on_device_recognizer_available"
                !apiSupported -> "android_on_device_asr_requires_api_31"
                else -> "on_device_recognizer_unavailable"
            },
            // Android reports a device recognizer capability, not a proof that
            // every language has been exercised.  The normal session must
            // still surface real recognition errors rather than falling back
            // to the network recognizer.
            "onDevice" to available,
            "languageVerification" to "runtime_required",
            "locale" to (languageTag(language) ?: language),
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

    private fun startRecognition(
        rawLanguage: String?,
        requestedCaptureId: String?,
        requestedLanguagePolicyKey: String?,
        result: MethodChannel.Result
    ) {
        if (!hasRecordAudioPermission()) {
            result.error(
                "microphone_permission_denied",
                "Microphone permission is required for device ASR.",
                null
            )
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            !SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)) {
            result.error(
                "on_device_asr_unavailable",
                "Android on-device speech recognition is unavailable.",
                availability(rawLanguage)
            )
            return
        }
        currentLanguage = normalizeLanguage(rawLanguage)
        captureId = requestedCaptureId?.trim()?.takeIf { it.isNotEmpty() }
        languagePolicyKey = requestedLanguagePolicyKey?.trim()?.takeIf { it.isNotEmpty() }
        captureStartedAtElapsedMs = SystemClock.elapsedRealtime()
        activeSegmentId = null
        activeRevision = 0
        speechStartedAtElapsedMs = null
        try {
            audioSessionCoordinator.beginCapture(audioSessionOwner)
        } catch (error: RuntimeException) {
            result.error("audio_session_unavailable", error.localizedMessage, null)
            return
        }
        running = true
        if (!ensureRecognizer()) {
            running = false
            audioSessionCoordinator.endCapture(audioSessionOwner)
            result.error(
                "on_device_asr_unavailable",
                "Android on-device speech recognition is unavailable.",
                availability(rawLanguage)
            )
            return
        }
        beginListening()
        result.success(null)
    }

    private fun stopRecognition() {
        running = false
        mainHandler.removeCallbacksAndMessages(null)
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
        activeSegmentId = null
        speechStartedAtElapsedMs = null
        captureId = null
        languagePolicyKey = null
        audioSessionCoordinator.endCapture(audioSessionOwner)
    }

    private fun ensureRecognizer(): Boolean {
        if (recognizer != null) return true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            !SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)) {
            return false
        }
        recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity).also {
            it.setRecognitionListener(listener)
        }
        return true
    }

    private fun beginListening() {
        val activeRecognizer = recognizer ?: return
        try {
            activeRecognizer.cancel()
            if (activeSegmentId == null) {
                activeSegmentId = "android_system_${sequence + 1}"
                activeRevision = 0
                speechStartedAtElapsedMs = null
            }
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
            if (ensureRecognizer()) beginListening()
            else emitFatalError("on_device_asr_unavailable", "Android on-device ASR became unavailable")
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
        override fun onBeginningOfSpeech() {
            speechStartedAtElapsedMs = SystemClock.elapsedRealtime()
        }
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
            val name = errorName(error)
            if (error == SpeechRecognizer.ERROR_NETWORK ||
                error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ||
                error == SpeechRecognizer.ERROR_SERVER) {
                running = false
                emitFatalError("on_device_asr_$name", name)
                return
            }
            emitState("system_asr_error", name)
            activeSegmentId = null
            speechStartedAtElapsedMs = null
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
        val now = SystemClock.elapsedRealtime()
        val start = speechStartedAtElapsedMs ?: captureStartedAtElapsedMs
        val segmentId = activeSegmentId ?: "android_system_${sequence + 1}"
        activeRevision += 1
        eventSink?.success(
            mutableMapOf<String, Any?>(
                "id" to segmentId,
                "text" to text,
                "language" to currentLanguage,
                "isFinal" to isFinal,
                "languageEvidence" to if (currentLanguage == "auto") "unknown" else "user_selected",
                "startMs" to (start - captureStartedAtElapsedMs).coerceAtLeast(0L),
                "endMs" to (now - captureStartedAtElapsedMs).coerceAtLeast(0L),
                "timingSource" to "client"
            ).apply {
                if (confidence != null) put("confidence", confidence)
                if (captureId != null && languagePolicyKey != null) {
                    put("captureId", captureId)
                    put("languagePolicyKey", languagePolicyKey)
                    put("revision", activeRevision)
                }
            }
        )
        if (isFinal) {
            sequence += 1
            activeSegmentId = null
            speechStartedAtElapsedMs = null
        }
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

    private fun emitFatalError(code: String, message: String) {
        eventSink?.error(code, message, availability(currentLanguage))
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
            normalized.matches(Regex("^[a-z]{2,3}(-[a-z0-9]{2,8})*$")) ->
                normalized.substringBefore('-')
            else -> "auto"
        }
    }

    private fun languageTag(language: String): String? {
        return when (language) {
            "zh" -> "zh-CN"
            "auto" -> null
            else -> Locale.forLanguageTag(language).toLanguageTag()
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
