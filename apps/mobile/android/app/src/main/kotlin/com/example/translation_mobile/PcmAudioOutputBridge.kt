package com.example.translation_mobile

import android.app.Activity
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Base64
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class PcmAudioOutputBridge(private val activity: Activity) {
    private var audioTrack: AudioTrack? = null
    private var playbackThread: Thread? = null
    private var pendingResult: MethodChannel.Result? = null

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
        if (bytes.isEmpty()) {
            result.error("invalid_pcm_audio", "PCM16 audio output payload is empty.", null)
            return
        }

        stopPlayback()
        val minBufferSize = AudioTrack.getMinBufferSize(
            rate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
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
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        audioTrack = track
        pendingResult = result
        playbackThread = Thread {
            try {
                track.play()
                var offset = 0
                while (offset < bytes.size && !Thread.currentThread().isInterrupted) {
                    val written = track.write(bytes, offset, bytes.size - offset)
                    if (written <= 0) break
                    offset += written
                }
            } finally {
                try {
                    track.stop()
                } catch (_: IllegalStateException) {
                }
                track.release()
                if (audioTrack === track) audioTrack = null
                finishPending(rate)
            }
        }
        playbackThread?.start()
    }

    private fun stopPlayback() {
        playbackThread?.interrupt()
        playbackThread = null
        audioTrack?.let { track ->
            try {
                track.stop()
            } catch (_: IllegalStateException) {
            }
            track.release()
        }
        audioTrack = null
        finishPending(null)
    }

    private fun finishPending(sampleRate: Int?) {
        val result = pendingResult ?: return
        pendingResult = null
        activity.runOnUiThread {
            result.success(
                mapOf(
                    "provider" to "server_pcm_tts",
                    "sampleRate" to (sampleRate ?: 24000)
                )
            )
        }
    }
}
