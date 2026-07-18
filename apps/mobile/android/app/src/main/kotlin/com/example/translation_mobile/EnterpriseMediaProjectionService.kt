package com.example.translation_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

class EnterpriseMediaProjectionService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var activeControl: EnterpriseMediaProjectionControl? = null
    private var intentionalStop = false
    private var monitoredProjection: MediaProjection? = null
    private var projectionCallback: MediaProjection.Callback? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            val requested = EnterpriseMediaProjectionControl.fromIntent(intent)
            if (requested != null && activeControl?.matches(requested) == true) {
                stopActive("user_stopped", notifyDart = true, stopProjection = true)
            }
            return START_NOT_STICKY
        }
        val control = intent?.let { EnterpriseMediaProjectionControl.fromIntent(it) }
        val callback = pendingStart
        if (control == null || callback == null || !callback.control.matches(control)) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        try {
            beginForeground(control)
            activeControl = control
            intentionalStop = false
            pendingStart = null
            callback.reply(null)
            scheduleExpiry(control)
        } catch (error: RuntimeException) {
            pendingStart = null
            callback.reply("media_projection_foreground_service_failed")
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (!intentionalStop && activeControl != null) {
            activeControl = null
            releaseProjection(stopProjection = true)
            stopListener?.invoke("foreground_service_destroyed")
        }
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun renew(control: EnterpriseMediaProjectionControl): Boolean {
        val current = activeControl ?: return false
        if (!current.matches(control) || !control.isValid()) return false
        activeControl = control
        scheduleExpiry(control)
        updateNotification(control)
        return true
    }

    private fun clear(identity: Triple<String, Int, String>): Boolean {
        val current = activeControl ?: return true
        if (current.shareId != identity.first ||
            current.generation != identity.second ||
            current.controlNonce != identity.third
        ) return false
        stopActive("app_stopped", notifyDart = false, stopProjection = false)
        return true
    }

    private fun stopActive(
        reason: String,
        notifyDart: Boolean,
        stopProjection: Boolean
    ) {
        if (activeControl == null) return
        activeControl = null
        intentionalStop = true
        handler.removeCallbacksAndMessages(null)
        releaseProjection(stopProjection)
        if (notifyDart) stopListener?.invoke(reason)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    private fun monitorProjection(
        control: EnterpriseMediaProjectionControl,
        projection: MediaProjection
    ): Boolean {
        if (activeControl?.matches(control) != true) return false
        releaseProjection(stopProjection = false)
        val callback = object : MediaProjection.Callback() {
            override fun onStop() {
                stopActive(
                    "system_projection_stopped",
                    notifyDart = true,
                    stopProjection = false
                )
            }
        }
        return try {
            projection.registerCallback(callback, handler)
            monitoredProjection = projection
            projectionCallback = callback
            true
        } catch (error: RuntimeException) {
            false
        }
    }

    private fun releaseProjection(stopProjection: Boolean) {
        val projection = monitoredProjection
        val callback = projectionCallback
        monitoredProjection = null
        projectionCallback = null
        if (projection != null && callback != null) {
            runCatching { projection.unregisterCallback(callback) }
        }
        if (stopProjection && projection != null) {
            runCatching { projection.stop() }
        }
    }

    private fun beginForeground(control: EnterpriseMediaProjectionControl) {
        val notification = notification(control)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(control: EnterpriseMediaProjectionControl) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification(control))
    }

    private fun notification(control: EnterpriseMediaProjectionControl): Notification {
        val stopIntent = control.putInto(
            Intent(this, EnterpriseMediaProjectionService::class.java).apply {
                action = ACTION_STOP
            }
        )
        val stopAction = PendingIntent.getService(
            this,
            control.generation,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(R.drawable.ic_screen_share_notification)
            .setContentTitle(getString(R.string.enterprise_screen_share_title))
            .setContentText(getString(R.string.enterprise_screen_share_body))
            .setContentIntent(contentIntent)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .addAction(stopNotificationAction(stopAction))
            .build()
    }

    private fun stopNotificationAction(stopAction: PendingIntent): Notification.Action =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Notification.Action.Builder(
                Icon.createWithResource(this, R.drawable.ic_stop_screen_share_notification),
                getString(R.string.enterprise_screen_share_stop),
                stopAction
            ).build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Action.Builder(
                R.drawable.ic_stop_screen_share_notification,
                getString(R.string.enterprise_screen_share_stop),
                stopAction
            ).build()
        }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.enterprise_screen_share_channel),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.enterprise_screen_share_channel_description)
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun scheduleExpiry(control: EnterpriseMediaProjectionControl) {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed(
            {
                if (activeControl?.matches(control) == true &&
                    System.currentTimeMillis() >= control.leaseExpiresAtMillis
                ) {
                    stopActive("lease_expired", notifyDart = true, stopProjection = true)
                }
            },
            (control.leaseExpiresAtMillis - System.currentTimeMillis()).coerceAtLeast(1)
        )
    }

    companion object {
        private const val CHANNEL_ID = "enterprise_screen_share"
        private const val NOTIFICATION_ID = 1707
        private const val ACTION_START =
            "com.example.translation_mobile.enterprise.SCREEN_SHARE_START"
        private const val ACTION_STOP =
            "com.example.translation_mobile.enterprise.SCREEN_SHARE_STOP"

        private data class PendingStart(
            val control: EnterpriseMediaProjectionControl,
            val reply: (String?) -> Unit
        )

        private var instance: EnterpriseMediaProjectionService? = null
        private var pendingStart: PendingStart? = null
        private var stopListener: ((String) -> Unit)? = null

        fun start(
            context: Context,
            control: EnterpriseMediaProjectionControl,
            reply: (String?) -> Unit
        ) {
            if (pendingStart != null || instance?.activeControl != null) {
                reply("media_projection_already_active")
                return
            }
            pendingStart = PendingStart(control, reply)
            val intent = control.putInto(
                Intent(context, EnterpriseMediaProjectionService::class.java).apply {
                    action = ACTION_START
                }
            )
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (error: RuntimeException) {
                pendingStart = null
                reply("media_projection_foreground_service_failed")
            }
        }

        fun renew(control: EnterpriseMediaProjectionControl): Boolean =
            instance?.renew(control) == true

        fun clear(identity: Triple<String, Int, String>): Boolean =
            instance?.clear(identity) ?: (pendingStart == null)

        fun isActive(control: EnterpriseMediaProjectionControl): Boolean =
            instance?.activeControl?.matches(control) == true

        fun monitorProjection(
            control: EnterpriseMediaProjectionControl,
            projection: MediaProjection
        ): Boolean = instance?.monitorProjection(control, projection) == true

        fun unmonitorProjection() {
            instance?.releaseProjection(stopProjection = false)
        }

        fun setStopListener(listener: ((String) -> Unit)?) {
            stopListener = listener
        }
    }
}
