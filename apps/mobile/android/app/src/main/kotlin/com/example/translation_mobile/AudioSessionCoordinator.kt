package com.example.translation_mobile

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class AudioSessionCoordinator(private val activity: FlutterActivity) : EventChannel.StreamHandler {
    private val audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val captureOwners = mutableSetOf<String>()
    private val playbackOwners = mutableSetOf<String>()
    private var eventSink: EventChannel.EventSink? = null
    private var focusRequest: AudioFocusRequest? = null
    private var hasFocus = false
    private var interrupted = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                val shouldResume = synchronized(this) {
                    hasFocus = true
                    val resume = interrupted && hasActiveOwners()
                    interrupted = false
                    resume
                }
                if (shouldResume) emit("interruption.ended", shouldResume = true)
            }
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                synchronized(this) {
                    hasFocus = false
                    interrupted = true
                }
                if (hasActiveOwners()) emit("interruption.began")
            }
        }
    }

    private val deviceCallback = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
                emitRouteChanged()
            }

            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
                emitRouteChanged()
            }
        }
    } else null

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && deviceCallback != null) {
            audioManager.registerAudioDeviceCallback(deviceCallback, null)
        }
    }

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, "translation_mobile/audio_session")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "beginCapture" -> runCatching {
                        beginCapture(FLUTTER_CAPTURE_OWNER)
                    }.fold(
                        onSuccess = { result.success(null) },
                        onFailure = {
                            result.error("audio_session_unavailable", it.localizedMessage, null)
                        }
                    )
                    "endCapture" -> {
                        endCapture(FLUTTER_CAPTURE_OWNER)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        EventChannel(messenger, "translation_mobile/audio_session/events")
            .setStreamHandler(this)
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventSink = events
        emitRouteChanged()
    }

    override fun onCancel(arguments: Any?) {
        eventSink = null
    }

    @Synchronized
    fun beginCapture(owner: String) {
        begin(owner, captureOwners)
    }

    @Synchronized
    fun endCapture(owner: String) {
        end(owner, captureOwners)
    }

    @Synchronized
    fun beginPlayback(owner: String) {
        begin(owner, playbackOwners)
    }

    @Synchronized
    fun endPlayback(owner: String) {
        end(owner, playbackOwners)
    }

    @Synchronized
    fun destroy() {
        captureOwners.clear()
        playbackOwners.clear()
        deactivate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && deviceCallback != null) {
            audioManager.unregisterAudioDeviceCallback(deviceCallback)
        }
        eventSink = null
    }

    private fun begin(owner: String, owners: MutableSet<String>) {
        if (!owners.add(owner)) return
        try {
            activate()
        } catch (error: RuntimeException) {
            owners.remove(owner)
            throw error
        }
    }

    private fun end(owner: String, owners: MutableSet<String>) {
        owners.remove(owner)
        if (!hasActiveOwners()) deactivate()
    }

    private fun activate() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (hasFocus) return
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = request
            audioManager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
        hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        check(hasFocus) { "Audio focus was not granted" }
    }

    private fun deactivate() {
        if (hasFocus) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let(audioManager::abandonAudioFocusRequest)
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(focusListener)
            }
        }
        hasFocus = false
        interrupted = false
        focusRequest = null
        audioManager.mode = AudioManager.MODE_NORMAL
    }

    @Synchronized
    private fun hasActiveOwners() = captureOwners.isNotEmpty() || playbackOwners.isNotEmpty()

    private fun emitRouteChanged() {
        emit("route.changed", route = currentRoute())
    }

    private fun currentRoute(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return "other"
        val types = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
        if (types.any { it == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    it == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }) return "bluetooth"
        if (types.any { it == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                    it == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    it == AudioDeviceInfo.TYPE_USB_HEADSET }) return "headphones"
        if (types.contains(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)) return "speaker"
        if (types.contains(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)) return "receiver"
        return "other"
    }

    private fun emit(type: String, shouldResume: Boolean = false, route: String? = null) {
        val event = mutableMapOf<String, Any>("type" to type)
        if (shouldResume) event["shouldResume"] = true
        if (route != null) event["route"] = route
        activity.runOnUiThread { eventSink?.success(event) }
    }

    private companion object {
        const val FLUTTER_CAPTURE_OWNER = "flutter_realtime_capture"
    }
}
