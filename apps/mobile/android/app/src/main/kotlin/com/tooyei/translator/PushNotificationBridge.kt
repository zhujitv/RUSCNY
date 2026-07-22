package com.tooyei.translator

import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.MethodChannel

/** Delivers token-rotation hints to the active Flutter engine without exposing the token. */
object PushNotificationBridge {
    @Volatile private var channel: MethodChannel? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    fun attach(value: MethodChannel) {
        channel = value
    }

    fun detach(value: MethodChannel?) {
        if (channel === value) channel = null
    }

    fun notifyRegistrationChanged() {
        mainHandler.post {
            channel?.invokeMethod("registrationChanged", null)
        }
    }
}
