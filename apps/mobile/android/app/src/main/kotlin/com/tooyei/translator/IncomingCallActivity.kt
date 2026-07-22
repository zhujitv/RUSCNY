package com.tooyei.translator

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/**
 * Privacy-safe lock-screen surface for an incoming call.
 *
 * MainActivity deliberately never renders over the keyguard. This activity
 * shows only generic copy and forwards an action to Flutter after Android has
 * allowed the normal app surface to become visible.
 */
class IncomingCallActivity : Activity() {
    private var callId: String? = null
    private var bindingId: String? = null
    private val timeoutHandler = Handler(Looper.getMainLooper())
    private var timeoutRunnable: Runnable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        active = WeakReference(this)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        clearTimeout()
        if (active?.get() === this) active = null
        super.onDestroy()
    }

    private fun handleIntent(intent: Intent?) {
        val incomingCallId = intent
            ?.getStringExtra(IncomingCallNotification.EXTRA_CALL_ID)
            ?.takeIf { it.isNotBlank() && it.length <= 200 }
        val action = intent?.getStringExtra(IncomingCallNotification.EXTRA_ACTION)
        val incomingBindingId = intent
            ?.getStringExtra(IncomingCallNotification.EXTRA_BINDING_ID)
            ?.takeIf { it.isNotBlank() && it.length <= 200 }
        val expiresAtMs = intent?.getLongExtra(
            IncomingCallNotification.EXTRA_EXPIRES_AT,
            0L,
        ) ?: 0L
        val nowMs = System.currentTimeMillis()
        val remainingMs = expiresAtMs - nowMs
        if (
            incomingCallId == null ||
            incomingBindingId == null ||
            action !in ALLOWED_ACTIONS ||
            expiresAtMs <= nowMs ||
            remainingMs > MAX_CALL_SURFACE_LIFETIME_MS
        ) {
            if (incomingCallId != null) {
                IncomingCallNotification.cancel(applicationContext, incomingCallId)
            }
            finish()
            return
        }
        val bindingActive = PushNotificationState.withStateLock {
            PushNotificationState.incomingCallsEnabled(applicationContext) &&
                PushNotificationState.matchesCurrentBinding(
                    applicationContext,
                    incomingBindingId,
                )
        }
        if (!bindingActive) {
            finish()
            return
        }
        callId = incomingCallId
        bindingId = incomingBindingId
        if (PushNotificationState.isCallClosed(applicationContext, incomingCallId)) {
            finish()
            return
        }
        scheduleTimeout(incomingCallId, remainingMs)

        val keyguard = getSystemService(KeyguardManager::class.java)
        when (action) {
            "answer" -> unlockThenForward(incomingCallId, "answer", keyguard)
            "decline" -> forward(incomingCallId, "decline")
            "show" -> {
                if (keyguard?.isKeyguardLocked == false) {
                    forward(incomingCallId, "show")
                } else {
                    renderPrivateSurface(incomingCallId)
                }
            }
        }
    }

    private fun unlockThenForward(
        incomingCallId: String,
        action: String,
        keyguard: KeyguardManager?,
    ) {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            keyguard?.isKeyguardLocked != true
        ) {
            forward(incomingCallId, action)
            return
        }
        keyguard.requestDismissKeyguard(
            this,
            object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    forward(incomingCallId, action)
                }

                override fun onDismissCancelled() {
                    renderPrivateSurface(incomingCallId)
                }

                override fun onDismissError() {
                    renderPrivateSurface(incomingCallId)
                }
            },
        )
    }

    private fun renderPrivateSurface(incomingCallId: String) {
        val density = resources.displayMetrics.density
        val padding = (32 * density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(Color.rgb(8, 63, 54))
        }
        root.addView(
            TextView(this).apply {
                text = getString(R.string.incoming_call_private_title)
                textSize = 32f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        root.addView(
            TextView(this).apply {
                text = getString(R.string.incoming_call_private_description)
                textSize = 17f
                setTextColor(Color.LTGRAY)
                gravity = Gravity.CENTER
                setPadding(0, (14 * density).toInt(), 0, (40 * density).toInt())
            },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        root.addView(actionButton(R.string.incoming_call_answer) {
            unlockThenForward(
                incomingCallId,
                "answer",
                getSystemService(KeyguardManager::class.java),
            )
        })
        root.addView(actionButton(R.string.incoming_call_decline) {
            forward(incomingCallId, "decline")
        })
        setContentView(root)
    }

    private fun actionButton(label: Int, onClick: () -> Unit): Button {
        val density = resources.displayMetrics.density
        return Button(this).apply {
            text = getString(label)
            textSize = 18f
            isAllCaps = false
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                (58 * density).toInt(),
            ).apply {
                topMargin = (12 * density).toInt()
            }
        }
    }

    private fun scheduleTimeout(incomingCallId: String, remainingMs: Long) {
        clearTimeout()
        val timeout = Runnable {
            if (callId != incomingCallId || isFinishing || isDestroyed) return@Runnable
            IncomingCallNotification.cancel(applicationContext, incomingCallId)
            finish()
        }
        timeoutRunnable = timeout
        // Handler delays are backed by the monotonic uptime clock, so a wall
        // clock correction after this point cannot keep the screen awake.
        timeoutHandler.postDelayed(timeout, remainingMs)
    }

    private fun clearTimeout() {
        timeoutRunnable?.let(timeoutHandler::removeCallbacks)
        timeoutRunnable = null
    }

    private fun forward(incomingCallId: String, action: String) {
        val expectedBindingId = bindingId
        val saved = expectedBindingId != null && PushNotificationState.withStateLock {
            PushNotificationState.incomingCallsEnabled(applicationContext) &&
                PushNotificationState.matchesCurrentBinding(
                    applicationContext,
                    expectedBindingId,
                ) &&
                PushNotificationState.saveIncomingCallAction(
                    applicationContext,
                    incomingCallId,
                    action,
                )
        }
        if (!saved) {
            finish()
            return
        }
        IncomingCallNotification.dismiss(applicationContext, incomingCallId)
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
        )
        finish()
    }

    companion object {
        private val ALLOWED_ACTIONS = setOf("show", "answer", "decline")
        private const val MAX_CALL_SURFACE_LIFETIME_MS = 2 * 60_000L

        @Volatile
        private var active: WeakReference<IncomingCallActivity>? = null

        fun dismiss(callId: String) {
            val activity = active?.get() ?: return
            if (activity.callId != callId) return
            activity.runOnUiThread { activity.finish() }
        }

        fun dismissAll() {
            val activity = active?.get() ?: return
            activity.runOnUiThread { activity.finish() }
        }
    }
}
