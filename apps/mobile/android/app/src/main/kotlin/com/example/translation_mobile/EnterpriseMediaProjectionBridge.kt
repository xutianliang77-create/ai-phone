package com.example.translation_mobile

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class EnterpriseMediaProjectionBridge(private val activity: Activity) {
    private var eventSink: EventChannel.EventSink? = null
    private var permissionResult: MethodChannel.Result? = null

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(::handle)
        EventChannel(messenger, "$CHANNEL/events").setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    eventSink = events
                }

                override fun onCancel(arguments: Any?) {
                    eventSink = null
                }
            }
        )
        EnterpriseMediaProjectionService.setStopListener { reason ->
            activity.runOnUiThread { eventSink?.success(mapOf("reason" to reason)) }
        }
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return false
        val result = permissionResult ?: return true
        permissionResult = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            result.success(null)
        } else {
            result.error(
                "notification_permission_denied",
                "Screen sharing requires a visible foreground notification.",
                null
            )
        }
        return true
    }

    fun destroy() {
        permissionResult?.error(
            "media_projection_activity_destroyed",
            "The screen sharing activity was destroyed.",
            null
        )
        permissionResult = null
        EnterpriseMediaProjectionService.setStopListener(null)
        eventSink = null
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isConfigured" -> result.success(isConfigured())
            "requestNotificationPermission" -> requestNotificationPermission(result)
            "prepare" -> prepare(call, result)
            "activate" -> activate(call, result)
            "renew" -> renew(call, result)
            "deactivate" -> {
                deactivateMonitor()
                result.success(null)
            }
            "clear" -> clear(call, result)
            else -> result.notImplemented()
        }
    }

    private fun isConfigured(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP ||
            webRtcPlugin() == null
        ) return false
        val info = runCatching {
            activity.packageManager.getServiceInfo(
                ComponentName(activity, EnterpriseMediaProjectionService::class.java),
                0
            )
        }.getOrNull() ?: return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            info.foregroundServiceType and
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION != 0
    }

    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            result.success(null)
            return
        }
        if (permissionResult != null) {
            result.error(
                "notification_permission_in_progress",
                "A notification permission request is already active.",
                null
            )
            return
        }
        permissionResult = result
        activity.requestPermissions(
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST
        )
    }

    private fun prepare(call: MethodCall, result: MethodChannel.Result) {
        val control = EnterpriseMediaProjectionControl.fromArguments(call.arguments)
        if (control == null) {
            result.error("invalid_media_projection_control", "Invalid screen share control.", null)
            return
        }
        EnterpriseMediaProjectionService.start(activity, control) { error ->
            activity.runOnUiThread {
                if (error == null) result.success(null)
                else result.error(error, "Unable to start screen sharing service.", null)
            }
        }
    }

    private fun activate(call: MethodCall, result: MethodChannel.Result) {
        val control = EnterpriseMediaProjectionControl.fromArguments(call.arguments)
        val trackId = call.argument<String>("captureTrackId")
        if (control == null ||
            trackId.isNullOrBlank() ||
            trackId.length > 128 ||
            !EnterpriseMediaProjectionService.isActive(control)
        ) {
            result.error("invalid_media_projection_activation", "Invalid screen share track.", null)
            return
        }
        try {
            deactivateMonitor()
            val plugin = webRtcPlugin()
                ?: throw IllegalStateException("flutter_webrtc unavailable")
            val handlerField = plugin.javaClass.getDeclaredField("methodCallHandler").apply {
                isAccessible = true
            }
            val methodHandler = handlerField.get(plugin)
            val mediaField = methodHandler.javaClass.getDeclaredField("getUserMediaImpl").apply {
                isAccessible = true
            }
            val media = mediaField.get(methodHandler)
                ?: throw IllegalStateException("getUserMedia unavailable")
            val info = media.javaClass
                .getMethod("getCapturerInfo", String::class.java)
                .invoke(media, trackId)
                ?: throw IllegalStateException("screen capturer unavailable")
            val capturer = info.javaClass.getField("capturer").get(info)
            if (capturer?.javaClass?.name != SCREEN_CAPTURER_CLASS) {
                throw IllegalStateException("screen capturer unavailable")
            }
            val projectionField = capturer.javaClass.getDeclaredField("mediaProjection").apply {
                isAccessible = true
            }
            val projection = projectionField.get(capturer) as? MediaProjection
                ?: throw IllegalStateException("media projection unavailable")
            if (!EnterpriseMediaProjectionService.monitorProjection(control, projection)) {
                throw IllegalStateException("media projection service unavailable")
            }
            result.success(null)
        } catch (error: ReflectiveOperationException) {
            deactivateMonitor()
            result.error(
                "media_projection_monitor_unavailable",
                "The pinned flutter_webrtc screen monitor is unavailable.",
                null
            )
        } catch (error: RuntimeException) {
            deactivateMonitor()
            result.error(
                "media_projection_monitor_unavailable",
                "The screen projection cannot be monitored.",
                null
            )
        }
    }

    private fun renew(call: MethodCall, result: MethodChannel.Result) {
        val control = EnterpriseMediaProjectionControl.fromArguments(call.arguments)
        if (control == null || !EnterpriseMediaProjectionService.renew(control)) {
            result.error("invalid_media_projection_renewal", "Screen share renewal was rejected.", null)
            return
        }
        result.success(null)
    }

    private fun clear(call: MethodCall, result: MethodChannel.Result) {
        val identity = EnterpriseMediaProjectionControl.identityFromArguments(call.arguments)
        if (identity == null || !EnterpriseMediaProjectionService.clear(identity)) {
            result.error("invalid_media_projection_clear", "Screen share clear was rejected.", null)
            return
        }
        result.success(null)
    }

    private fun deactivateMonitor() {
        EnterpriseMediaProjectionService.unmonitorProjection()
    }

    private fun webRtcPlugin(): Any? = runCatching {
        val pluginClass = Class.forName(WEBRTC_PLUGIN_CLASS)
        pluginClass.getField("sharedSingleton").get(null)
    }.getOrNull()

    companion object {
        private const val CHANNEL =
            "translation_mobile/enterprise_media_projection"
        private const val NOTIFICATION_PERMISSION_REQUEST = 7107
        private const val WEBRTC_PLUGIN_CLASS =
            "com.cloudwebrtc.webrtc.FlutterWebRTCPlugin"
        private const val SCREEN_CAPTURER_CLASS =
            "com.cloudwebrtc.webrtc.OrientationAwareScreenCapturer"
    }
}
