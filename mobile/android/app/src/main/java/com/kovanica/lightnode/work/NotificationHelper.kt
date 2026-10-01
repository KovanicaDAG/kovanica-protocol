package com.kovanica.lightnode.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Helpers for posting local notifications from the background sync worker.
 *
 * Uses a single notification channel for all wallet events. The small icon is
 * a system drawable so the slice does not need to add new image assets.
 */
internal object NotificationHelper {

    const val CHANNEL_ID = "kovanica_light_node"
    private const val CHANNEL_NAME = "Kovanica Light Node"
    private const val CHANNEL_DESCRIPTION = "Background sync and wallet events"

    /**
     * Create the notification channel on API 26+. Safe to call repeatedly.
     */
    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = CHANNEL_DESCRIPTION }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    /**
     * Post a local notification. On Android 13+ the app still needs the
     * POST_NOTIFICATIONS permission (declared in the manifest). The runtime
     * permission request is intentionally left out of this slice to keep the
     * existing UI screens unchanged; users can enable notifications in system
     * settings.
     */
    fun showNotification(
        context: Context,
        id: Int,
        title: String,
        message: String,
    ) {
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
        NotificationManagerCompat.from(context).notify(id, builder.build())
    }
}
