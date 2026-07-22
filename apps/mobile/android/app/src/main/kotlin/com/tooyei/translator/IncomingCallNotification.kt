package com.tooyei.translator

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

object IncomingCallNotification {
    const val EXTRA_CALL_ID = "friend_call_id"
    const val EXTRA_ACTION = "friend_call_action"
    const val EXTRA_EXPIRES_AT = "friend_call_expires_at"
    const val EXTRA_BINDING_ID = "friend_call_binding_id"
    const val CHANNEL_ID = "friend_incoming_calls_v1"

    private const val CHANNEL_NAME = "好友实时来电"
    private const val NOTIFICATION_TAG = "friend_incoming_call"
    private const val NOTIFICATION_TIMEOUT_MS = 60_000L

    fun show(
        context: Context,
        callId: String,
        callerName: String,
        title: String,
        answerLabel: String,
        declineLabel: String,
        bindingId: String? = null,
        expiresAtMs: Long = System.currentTimeMillis() + NOTIFICATION_TIMEOUT_MS,
    ): Boolean = PushNotificationState.withStateLock {
        val currentBindingId = PushNotificationState.currentBindingId(context)
        if (
            !PushNotificationState.incomingCallsEnabled(context) ||
            currentBindingId == null ||
            (bindingId != null &&
                !PushNotificationState.matchesCurrentBinding(context, bindingId))
        ) {
            return@withStateLock false
        }
        showLocked(
            context,
            callId,
            callerName,
            title,
            answerLabel,
            declineLabel,
            expiresAtMs,
            currentBindingId,
        )
    }

    private fun showLocked(
        context: Context,
        callId: String,
        callerName: String,
        title: String,
        answerLabel: String,
        declineLabel: String,
        expiresAtMs: Long,
        bindingId: String,
    ): Boolean {
        val remainingMs = expiresAtMs - System.currentTimeMillis()
        if (remainingMs <= 0L || remainingMs > MAX_NOTIFICATION_LIFETIME_MS) return false
        if (PushNotificationState.isCallClosed(context, callId)) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannel(manager)
        if (!manager.areNotificationsEnabled()) return false
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            manager.getNotificationChannel(CHANNEL_ID)?.importance ==
                NotificationManager.IMPORTANCE_NONE
        ) {
            return false
        }
        val fullScreenIntent = actionIntent(
            context, callId, "show", 0, expiresAtMs, bindingId,
        )
        val answerIntent = actionIntent(
            context, callId, "answer", 1, expiresAtMs, bindingId,
        )
        val declineIntent = actionIntent(
            context, callId, "decline", 2, expiresAtMs, bindingId,
        )

        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }
        builder
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title)
            .setContentText(callerName)
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(fullScreenIntent)

        @Suppress("DEPRECATION")
        val publicBuilder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }
        builder.setPublicVersion(
            publicBuilder
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle(title)
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .build(),
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setTimeoutAfter(remainingMs)
        } else {
            @Suppress("DEPRECATION")
            builder
                .setPriority(Notification.PRIORITY_MAX)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                .setVibrate(longArrayOf(0, 700, 350, 700))
        }
        if (canUseFullScreenIntent(manager)) {
            builder.setFullScreenIntent(fullScreenIntent, true)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val person = Person.Builder().setName(callerName).setImportant(true).build()
            builder.setStyle(
                Notification.CallStyle.forIncomingCall(
                    person,
                    declineIntent,
                    answerIntent,
                ),
            )
        } else {
            builder
                .setPriority(Notification.PRIORITY_MAX)
                .addAction(0, declineLabel, declineIntent)
                .addAction(0, answerLabel, answerIntent)
        }

        val notification = builder.build().apply {
            flags = flags or Notification.FLAG_INSISTENT
        }
        manager.notify(NOTIFICATION_TAG, notificationId(callId), notification)
        return true
    }

    fun cancel(context: Context, callId: String) = PushNotificationState.withStateLock {
        cancelLocked(context, callId)
    }

    fun cancelForBinding(context: Context, bindingId: String, callId: String): Boolean =
        PushNotificationState.withStateLock {
            if (!PushNotificationState.matchesCurrentBinding(context, bindingId)) {
                return@withStateLock false
            }
            cancelLocked(context, callId)
            true
        }

    private fun cancelLocked(context: Context, callId: String) {
        PushNotificationState.markCallClosed(context, callId)
        dismissLocked(context, callId)
    }

    /** Hides the surface without declaring the server call terminal. */
    fun dismiss(context: Context, callId: String) = PushNotificationState.withStateLock {
        dismissLocked(context, callId)
    }

    private fun dismissLocked(context: Context, callId: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val id = notificationId(callId)
        manager.cancel(NOTIFICATION_TAG, id)
        // Remove an untagged notification left by an older installed build.
        manager.cancel(id)
        IncomingCallActivity.dismiss(callId)
    }

    fun cancelAll(context: Context) = PushNotificationState.withStateLock {
        cancelAllLocked(context)
    }

    fun setIncomingCallsEnabled(context: Context, enabled: Boolean) =
        PushNotificationState.withStateLock {
            PushNotificationState.setIncomingCallsEnabled(context, enabled)
            if (!enabled) cancelAllLocked(context)
        }

    fun clearBindingAndCancelAll(context: Context) = PushNotificationState.withStateLock {
        PushNotificationState.clearBinding(context)
        cancelAllLocked(context)
    }

    private fun cancelAllLocked(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications
            .filter {
                it.tag == NOTIFICATION_TAG ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                        it.notification.channelId == CHANNEL_ID)
            }
            .forEach {
                if (it.tag == null) manager.cancel(it.id)
                else manager.cancel(it.tag, it.id)
            }
        IncomingCallActivity.dismissAll()
    }

    private fun ensureChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "显示好友实时翻译语音和视频来电"
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 700, 350, 700)
            setSound(ringtone, audioAttributes)
        }
        manager.createNotificationChannel(channel)
    }

    private fun actionIntent(
        context: Context,
        callId: String,
        action: String,
        requestOffset: Int,
        expiresAtMs: Long,
        bindingId: String,
    ): PendingIntent {
        val intent = Intent(context, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_ACTION, action)
            putExtra(EXTRA_EXPIRES_AT, expiresAtMs)
            putExtra(EXTRA_BINDING_ID, bindingId)
        }
        return PendingIntent.getActivity(
            context,
            notificationId(callId) + requestOffset,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun notificationId(callId: String): Int =
        0x43000000 or (callId.hashCode() and 0x00ffffff)

    fun notificationsEnabled(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            manager.getNotificationChannel(CHANNEL_ID)?.importance !=
            NotificationManager.IMPORTANCE_NONE
    }

    fun channelEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannel(manager)
        return manager.getNotificationChannel(CHANNEL_ID)?.importance !=
            NotificationManager.IMPORTANCE_NONE
    }

    fun fullScreenIntentAllowed(context: Context): Boolean =
        canUseFullScreenIntent(context.getSystemService(NotificationManager::class.java))

    private fun canUseFullScreenIntent(manager: NotificationManager): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            manager.canUseFullScreenIntent()

    private const val MAX_NOTIFICATION_LIFETIME_MS = 2 * 60_000L
}
