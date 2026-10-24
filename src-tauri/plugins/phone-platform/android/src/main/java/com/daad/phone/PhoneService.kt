package com.daad.phone

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder

/** Keeps the native SIP process available while the window is in the background.
 * Force-stop/process death still requires reopening Daad; this is not push calling. */
class PhoneService: Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        running = true
        createChannels(this)
        startForeground(1, notification(this, lastState))
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        running = false
        lastState = "Idle"
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
    companion object {
        private var running = false
        private var lastState = "Idle"
        private fun createChannels(context: Context) {
            if (Build.VERSION.SDK_INT >= 26) {
                val manager = context.getSystemService(NotificationManager::class.java)
                manager.createNotificationChannel(NotificationChannel("daad-service", "Phone connection", NotificationManager.IMPORTANCE_LOW))
                manager.createNotificationChannel(NotificationChannel("daad-calls", "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null) })
            }
        }
        private fun notification(context: Context, state: String): Notification {
            val incoming = state == "Incoming"
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, if (incoming) "daad-calls" else "daad-service") else Notification.Builder(context)
            return builder.setSmallIcon(android.R.drawable.sym_action_call).setContentTitle("Daad")
                .setContentText(when(state) { "Incoming" -> "Incoming call — tap to answer"; "Active", "Holding" -> "Call in progress — tap to open"; else -> "Phone service running — tap to open" })
                .setContentIntent(pending).setCategory(if (incoming) Notification.CATEGORY_CALL else Notification.CATEGORY_SERVICE)
                .setOngoing(true).build()
        }
        fun update(context: Context, state: String) {
            lastState = state
            if (!running) return
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            createChannels(context)
            context.getSystemService(NotificationManager::class.java).notify(1, notification(context, state))
        }
    }
}
