package com.timsrobot.trif.probe

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder

// Part C2: the foreground service a real TRIF would run while a page plays media in the background.
// It does nothing but exist: its job is to keep the app (and so the WebView's renderer) from being frozen.
class MediaService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("media", "Playing", NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(this, "media").setContentTitle("TRIF probe").setContentText("Playing in the background")
            .setSmallIcon(android.R.drawable.ic_media_play).build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        return START_NOT_STICKY
    }
}
