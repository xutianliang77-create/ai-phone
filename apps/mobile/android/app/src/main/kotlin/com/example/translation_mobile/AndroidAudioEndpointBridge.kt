package com.example.translation_mobile

import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/** Side-analyzes the already captured Flutter PCM. It never creates an
 * AudioRecord, SpeechRecognizer, network connection or second microphone. */
internal class AndroidAudioEndpointBridge(private val activity: FlutterActivity) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "wujie-android-vad").apply { isDaemon = true }
    }
    private val generation = AtomicLong()
    @Volatile private var desiredRequestId: String? = null
    // The remaining fields are owned only by worker's serial thread.
    private var activeRequestId: String? = null
    private var activeSampleRate = 0
    private var lastSequence = -1L
    private var model: SileroOnnxVad? = null
    private var segmenter: SileroEndpointSegmenter? = null

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, "translation_mobile/android_audio_endpoint")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "endpoint.start" -> start(call, result)
                    "endpoint.process" -> process(call, result)
                    "endpoint.stop" -> stop(call, result)
                    else -> result.notImplemented()
                }
            }
    }

    fun destroy() {
        desiredRequestId = null
        generation.incrementAndGet()
        worker.execute {
            runCatching { closeActive() }
            worker.shutdown()
        }
    }

    private fun start(call: MethodCall, result: MethodChannel.Result) {
        val id = call.argument<String>("requestId")
        val rate = call.argument<Number>("sampleRate")?.toInt() ?: 0
        val provider = call.argument<String>("vadProvider")
        val threshold = call.argument<Number>("vadThreshold")?.toFloat()
        val negative = call.argument<Number>("vadNegativeThreshold")?.toFloat()
        val minSpeech = call.argument<Number>("endpointMinSpeechMs")?.toInt()
        val silence = call.argument<Number>("endpointSilenceMs")?.toInt()
        if (id.isNullOrBlank() || id.length > 120 || rate !in listOf(16000, 24000) ||
            provider != "silero_onnx" || threshold == null || threshold <= 0f ||
            threshold >= 1f || negative == null || negative < 0f || negative >= threshold ||
            minSpeech == null || minSpeech !in 32..2000 ||
            silence == null || silence !in 100..3000) {
            result.error("android_vad_invalid_config", "Android model VAD configuration is invalid", null)
            return
        }
        val epoch = generation.incrementAndGet()
        desiredRequestId = id
        worker.execute {
            try {
                closeActive()
                if (generation.get() != epoch || desiredRequestId != id) {
                    fail(result, "android_vad_cancelled", "Endpoint start was cancelled")
                    return@execute
                }
                val loaded = SileroOnnxVad.load(activity.assets)
                if (generation.get() != epoch || desiredRequestId != id) {
                    loaded.close()
                    fail(result, "android_vad_cancelled", "Endpoint start was cancelled")
                    return@execute
                }
                model = loaded
                segmenter = SileroEndpointSegmenter(loaded, rate, threshold,
                    negative, minSpeech, silence)
                activeRequestId = id
                activeSampleRate = rate
                lastSequence = -1L
                main.post {
                    if (generation.get() == epoch && desiredRequestId == id) {
                        result.success(mapOf("requestId" to id, "ready" to true,
                            "provider" to "silero_onnx"))
                    } else result.error("android_vad_cancelled", "Endpoint start was cancelled", null)
                }
            } catch (_: Exception) { failClosed(epoch, result, "android_vad_unavailable") }
              catch (_: LinkageError) { failClosed(epoch, result, "android_vad_unavailable") }
        }
    }

    private fun process(call: MethodCall, result: MethodChannel.Result) {
        val id = call.argument<String>("requestId")
        val sequence = call.argument<Number>("sequence")?.toLong()
        val pcm = call.argument<ByteArray>("pcm")
        if (id == null || id != desiredRequestId || sequence == null || sequence < 0 ||
            pcm == null || pcm.isEmpty() || pcm.size % 2 != 0) {
            result.error("android_vad_frame_invalid", "Endpoint PCM or request is invalid", null)
            return
        }
        val epoch = generation.get()
        worker.execute {
            if (epoch != generation.get() || activeRequestId != id ||
                sequence <= lastSequence || pcm.size > activeSampleRate * 2) {
                fail(result, "android_vad_frame_invalid", "Endpoint frame is stale or invalid")
                return@execute
            }
            try {
                val boundary = checkNotNull(segmenter).acceptPcm16(pcm)
                val speechStarted = checkNotNull(segmenter).speechStarted
                lastSequence = sequence
                main.post {
                    if (epoch == generation.get() && desiredRequestId == id) {
                        result.success(mapOf("requestId" to id, "sequence" to sequence,
                            "boundary" to boundary, "speechStarted" to speechStarted))
                    } else result.error("android_vad_cancelled", "Endpoint frame was cancelled", null)
                }
            } catch (_: Exception) { failClosed(epoch, result, "android_vad_inference_failed") }
              catch (_: LinkageError) { failClosed(epoch, result, "android_vad_inference_failed") }
        }
    }

    private fun stop(call: MethodCall, result: MethodChannel.Result) {
        val id = call.argument<String>("requestId")
        if (id == null || id != desiredRequestId) {
            result.success(null)
            return
        }
        desiredRequestId = null
        generation.incrementAndGet()
        worker.execute {
            try {
                closeActive()
                main.post { result.success(null) }
            } catch (_: Exception) {
                fail(result, "android_vad_stop_failed", "Android VAD resource could not stop cleanly")
            }
        }
    }

    private fun failClosed(epoch: Long, result: MethodChannel.Result, code: String) {
        runCatching { closeActive() }
        if (generation.compareAndSet(epoch, epoch + 1)) desiredRequestId = null
        fail(result, code, if (code == "android_vad_unavailable")
            "Verified Android VAD model could not start" else "Android model VAD inference failed")
    }

    private fun closeActive() {
        activeRequestId = null
        activeSampleRate = 0
        lastSequence = -1L
        segmenter = null
        val active = model
        model = null
        active?.close()
    }

    private fun fail(result: MethodChannel.Result, code: String, message: String) {
        main.post { result.error(code, message, null) }
    }
}
