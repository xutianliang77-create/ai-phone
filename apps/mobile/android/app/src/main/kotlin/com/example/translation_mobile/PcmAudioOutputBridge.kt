package com.example.translation_mobile

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Base64
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class PcmAudioOutputBridge(
    private val activity: FlutterActivity,
    private val audioSessionCoordinator: AudioSessionCoordinator
) {
    private val audioSessionOwner = "server_pcm_tts"
    private val mainHandler = Handler(Looper.getMainLooper())
    private var audioTrack: AudioTrack? = null
    private var pendingResult: MethodChannel.Result? = null
    private var pendingSampleRate = 24000
    private var watchdog: Runnable? = null

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, "translation_mobile/audio_output")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "playPcm" -> playPcm(call, result)
                    "stop" -> {
                        stopPlayback()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    fun destroy() {
        stopPlayback()
    }

    private fun playPcm(call: MethodCall, result: MethodChannel.Result) {
        val format = call.argument<String>("format")
        val sampleRate = call.argument<Int>("sampleRate")
        val encoded = call.argument<String>("data")
        if (format != "pcm16" || sampleRate !in setOf(16000, 24000) || encoded.isNullOrBlank()) {
            result.error("invalid_pcm_audio", "PCM16 audio output payload is invalid.", null)
            return
        }
        val rate = sampleRate ?: 24000
        val bytes = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            result.error("invalid_pcm_audio", "PCM16 audio output payload is invalid.", null)
            return
        }
        if (bytes.size < 2 || bytes.size % 2 != 0) {
            result.error("invalid_pcm_audio", "PCM16 audio output payload is invalid.", null)
            return
        }

        stopPlayback()
        try {
            audioSessionCoordinator.beginPlayback(audioSessionOwner)
        } catch (error: RuntimeException) {
            result.error("audio_session_unavailable", error.localizedMessage, null)
            return
        }
        try {
            val minBufferSize = AudioTrack.getMinBufferSize(
                rate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(rate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(maxOf(minBufferSize, bytes.size))
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
            audioTrack = track
            pendingResult = result
            pendingSampleRate = rate
            val frames = bytes.size / 2
            track.notificationMarkerPosition = frames
            track.setPlaybackPositionUpdateListener(
                object : AudioTrack.OnPlaybackPositionUpdateListener {
                    override fun onMarkerReached(completedTrack: AudioTrack?) {
                        if (audioTrack === completedTrack) completePlayback()
                    }

                    override fun onPeriodicNotification(track: AudioTrack?) = Unit
                },
                mainHandler
            )
            val written = track.write(bytes, 0, bytes.size)
            if (written != bytes.size) {
                pendingResult = null
                releaseTrack()
                audioSessionCoordinator.endPlayback(audioSessionOwner)
                result.error("pcm_audio_playback_failed", "PCM audio could not be buffered.", null)
                return
            }
            scheduleWatchdog(bytes.size, rate)
            track.play()
        } catch (error: RuntimeException) {
            watchdog?.let(mainHandler::removeCallbacks)
            watchdog = null
            pendingResult = null
            releaseTrack()
            audioSessionCoordinator.endPlayback(audioSessionOwner)
            result.error("pcm_audio_playback_failed", error.localizedMessage, null)
        }
    }

    private fun stopPlayback() {
        watchdog?.let(mainHandler::removeCallbacks)
        watchdog = null
        releaseTrack()
        audioSessionCoordinator.endPlayback(audioSessionOwner)
        finishPending()
    }

    private fun completePlayback() {
        watchdog?.let(mainHandler::removeCallbacks)
        watchdog = null
        releaseTrack()
        audioSessionCoordinator.endPlayback(audioSessionOwner)
        finishPending()
    }

    private fun releaseTrack() {
        val track = audioTrack ?: return
        audioTrack = null
        try {
            track.stop()
        } catch (_: IllegalStateException) {
        }
        track.release()
    }

    private fun finishPending() {
        val result = pendingResult ?: return
        pendingResult = null
        activity.runOnUiThread {
            result.success(
                mapOf(
                    "provider" to "server_pcm_tts",
                    "sampleRate" to pendingSampleRate
                )
            )
        }
    }

    private fun scheduleWatchdog(byteCount: Int, sampleRate: Int) {
        val durationMs = (byteCount * 1000L / (sampleRate * 2L) + 2000L)
            .coerceIn(3000L, 65000L)
        val task = Runnable { completePlayback() }
        watchdog = task
        mainHandler.postDelayed(task, durationMs)
    }
}
