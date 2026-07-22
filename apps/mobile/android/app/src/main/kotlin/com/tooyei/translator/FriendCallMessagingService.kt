package com.tooyei.translator

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.Locale

/** Receives time-sensitive call pushes without requiring Flutter to be running. */
class FriendCallMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushNotificationState.saveRegistrationId(applicationContext, token)
        PushNotificationBridge.notifyRegistrationChanged()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["schemaVersion"] != SCHEMA_VERSION) return
        val bindingId = data["bindingId"] ?: return
        if (!PushNotificationState.matchesCurrentBinding(applicationContext, bindingId)) return
        val callId = data["callId"]?.takeIf(::validCallId) ?: return
        when (data["event"]) {
            EVENT_INCOMING -> showIncomingCall(callId, bindingId, data)
            EVENT_CANCEL -> IncomingCallNotification.cancelForBinding(
                applicationContext,
                bindingId,
                callId,
            )
        }
    }

    private fun showIncomingCall(
        callId: String,
        bindingId: String,
        data: Map<String, String>,
    ) {
        // A registration token can briefly remain deliverable after an offline
        // logout or an account switch. Never surface another account's call
        // unless Flutter has successfully bound this installation to the
        // current authenticated device session.
        if (!PushNotificationState.incomingCallsEnabled(applicationContext)) return
        val now = System.currentTimeMillis()
        val expiresAt = data["expiresAt"]?.toLongOrNull() ?: return
        if (expiresAt <= now || expiresAt - now > MAX_FUTURE_EXPIRY_MS) {
            PushNotificationState.markCallClosed(applicationContext, callId, now)
            return
        }
        if (PushNotificationState.isCallClosed(applicationContext, callId, now)) return
        val mediaType = data["mediaType"]
        if (mediaType != "AUDIO" && mediaType != "VIDEO") return
        val callerName = data["callerDisplayName"]
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.take(MAX_CALLER_NAME_LENGTH)
            ?: return
        val russian = Locale.getDefault().language.equals("ru", ignoreCase = true)
        val title = when {
            russian && mediaType == "VIDEO" -> "Видеозвонок с переводом"
            russian -> "Аудиозвонок с переводом"
            mediaType == "VIDEO" -> "实时翻译视频来电"
            else -> "实时翻译语音来电"
        }
        val shown = IncomingCallNotification.show(
            applicationContext,
            callId,
            callerName,
            title,
            if (russian) "Ответить" else "接听",
            if (russian) "Отклонить" else "拒绝",
            bindingId,
            expiresAt,
        )
        if (!shown) {
            Log.w(TAG, "Incoming call push received but notifications are disabled")
        }
    }

    private fun validCallId(value: String): Boolean =
        value.length in 1..200 && value.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    private companion object {
        const val TAG = "FriendCallPush"
        const val SCHEMA_VERSION = "1"
        const val EVENT_INCOMING = "friend.call.incoming"
        const val EVENT_CANCEL = "friend.call.cancel"
        const val MAX_CALLER_NAME_LENGTH = 100
        const val MAX_FUTURE_EXPIRY_MS = 2 * 60_000L
    }
}
