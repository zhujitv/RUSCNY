package com.tooyei.translator

import android.content.Context
import java.util.UUID

/** Small device-local state shared by the FCM service and call notification UI. */
object PushNotificationState {
    private const val PREFERENCES = "friend_call_push_state"
    private const val TOKEN_KEY = "fcm_registration_id"
    private const val INCOMING_CALLS_ENABLED_KEY = "incoming_calls_enabled"
    private const val BINDING_OWNER_KEY = "push_binding_owner"
    private const val BINDING_ID_KEY = "push_binding_id"
    private const val PENDING_ACTION_KEY = "pending_call_action"
    private const val PENDING_CALL_ID_KEY = "pending_call_id"
    private const val PENDING_ACTION_AT_KEY = "pending_call_action_at"
    private const val CLOSED_PREFIX = "closed_call_"
    private const val PENDING_ACTION_RETENTION_MS = 60 * 1_000L
    private const val CLOSED_RETENTION_MS = 24 * 60 * 60 * 1_000L
    private val ALLOWED_ACTIONS = setOf("show", "answer", "decline")

    /** Shared re-entrant lock for state checks that must include notification I/O. */
    internal fun <T> withStateLock(block: () -> T): T = synchronized(this, block)

    fun saveRegistrationId(context: Context, registrationId: String) {
        if (registrationId.isBlank()) return
        preferences(context).edit().putString(TOKEN_KEY, registrationId).apply()
    }

    fun registrationId(context: Context): String? =
        preferences(context).getString(TOKEN_KEY, null)?.takeIf { it.isNotBlank() }

    fun setIncomingCallsEnabled(context: Context, enabled: Boolean) {
        val accepted = enabled && currentBindingId(context) != null
        preferences(context).edit().putBoolean(INCOMING_CALLS_ENABLED_KEY, accepted).apply()
    }

    fun incomingCallsEnabled(context: Context): Boolean =
        preferences(context).getBoolean(INCOMING_CALLS_ENABLED_KEY, false)

    @Synchronized
    fun bindingForSubject(context: Context, subjectId: String): String {
        val preferences = preferences(context)
        val existingOwner = preferences.getString(BINDING_OWNER_KEY, null)
        val existingBinding = preferences.getString(BINDING_ID_KEY, null)
        if (existingOwner == subjectId && !existingBinding.isNullOrBlank()) {
            return existingBinding
        }
        val bindingId = UUID.randomUUID().toString()
        preferences.edit()
            .putString(BINDING_OWNER_KEY, subjectId)
            .putString(BINDING_ID_KEY, bindingId)
            .putBoolean(INCOMING_CALLS_ENABLED_KEY, false)
            .commit()
        return bindingId
    }

    fun currentBindingId(context: Context): String? =
        preferences(context).getString(BINDING_ID_KEY, null)?.takeIf { it.isNotBlank() }

    fun matchesCurrentBinding(context: Context, bindingId: String): Boolean =
        bindingId.isNotBlank() && bindingId == currentBindingId(context)

    fun clearBinding(context: Context) {
        preferences(context).edit()
            .remove(BINDING_OWNER_KEY)
            .remove(BINDING_ID_KEY)
            .remove(PENDING_ACTION_KEY)
            .remove(PENDING_CALL_ID_KEY)
            .remove(PENDING_ACTION_AT_KEY)
            .putBoolean(INCOMING_CALLS_ENABLED_KEY, false)
            .commit()
    }

    @Synchronized
    fun saveIncomingCallAction(
        context: Context,
        callId: String,
        action: String,
        nowMs: Long = System.currentTimeMillis(),
    ): Boolean {
        if (
            callId.isBlank() ||
            callId.length > 200 ||
            action !in ALLOWED_ACTIONS ||
            isCallClosed(context, callId, nowMs)
        ) {
            return false
        }
        return preferences(context).edit()
            .putString(PENDING_ACTION_KEY, action)
            .putString(PENDING_CALL_ID_KEY, callId)
            .putLong(PENDING_ACTION_AT_KEY, nowMs)
            .commit()
    }

    @Synchronized
    fun peekIncomingCallAction(
        context: Context,
        nowMs: Long = System.currentTimeMillis(),
    ): Map<String, String>? {
        val preferences = preferences(context)
        val action = preferences.getString(PENDING_ACTION_KEY, null)
        val callId = preferences.getString(PENDING_CALL_ID_KEY, null)
        val savedAt = preferences.getLong(PENDING_ACTION_AT_KEY, 0L)
        if (
            action !in ALLOWED_ACTIONS ||
            callId.isNullOrBlank() ||
            savedAt <= 0L ||
            nowMs - savedAt !in 0L..PENDING_ACTION_RETENTION_MS ||
            isCallClosed(context, callId, nowMs)
        ) {
            clearPendingIncomingCallAction(preferences)
            return null
        }
        return mapOf("action" to action!!, "callId" to callId)
    }

    @Synchronized
    fun acknowledgeIncomingCallAction(
        context: Context,
        callId: String,
        action: String,
    ): Boolean {
        if (callId.isBlank() || action !in ALLOWED_ACTIONS) return false
        val preferences = preferences(context)
        if (
            preferences.getString(PENDING_CALL_ID_KEY, null) != callId ||
            preferences.getString(PENDING_ACTION_KEY, null) != action
        ) {
            return false
        }
        return clearPendingIncomingCallAction(preferences)
    }

    fun markCallClosed(context: Context, callId: String, nowMs: Long = System.currentTimeMillis()) {
        if (callId.isBlank()) return
        val preferences = preferences(context)
        val editor = preferences.edit().putLong(CLOSED_PREFIX + callId, nowMs)
        preferences.all.forEach { (key, value) ->
            if (
                key.startsWith(CLOSED_PREFIX) &&
                value is Long &&
                nowMs - value > CLOSED_RETENTION_MS
            ) {
                editor.remove(key)
            }
        }
        editor.apply()
    }

    fun isCallClosed(context: Context, callId: String, nowMs: Long = System.currentTimeMillis()): Boolean {
        val closedAt = preferences(context).getLong(CLOSED_PREFIX + callId, 0L)
        if (closedAt <= 0L) return false
        if (nowMs - closedAt <= CLOSED_RETENTION_MS) return true
        preferences(context).edit().remove(CLOSED_PREFIX + callId).apply()
        return false
    }

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private fun clearPendingIncomingCallAction(
        preferences: android.content.SharedPreferences,
    ): Boolean = preferences.edit()
        .remove(PENDING_ACTION_KEY)
        .remove(PENDING_CALL_ID_KEY)
        .remove(PENDING_ACTION_AT_KEY)
        .commit()
}
