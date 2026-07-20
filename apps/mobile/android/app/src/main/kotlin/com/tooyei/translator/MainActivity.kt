package com.tooyei.translator

import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import com.alivc.rtc.AliRtcEngine
import com.alivc.rtc.AliRtcEngineEventListener
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.min

class MainActivity : FlutterActivity() {
    private var rtcEngine: AliRtcEngine? = null
    private var channel: MethodChannel? = null
    private var audioCueChannel: MethodChannel? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val shutdownCallbacks = mutableListOf<() -> Unit>()
    private var shuttingDown = false
    private var destroyingEngine: AliRtcEngine? = null
    private var leaveTimeout: Runnable? = null
    private val translationCaptureLock = Any()
    private val translationCaptureBuffer = ByteArrayOutputStream(6_400)
    private val translationPlaybackLock = Any()
    private val translationPlaybackExecutor = Executors.newSingleThreadExecutor()
    @Volatile private var translationCaptureEnabled = false
    private var translationAudioTrack: AudioTrack? = null
    private var translationAudioSampleRate = 0
    private var ringbackTone: ToneGenerator? = null
    private var ringbackPulse: Runnable? = null
    private var incomingRingtone: Ringtone? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        captureIncomingCallAction(intent)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureIncomingCallAction(intent)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.tooyei.translator/rtc",
        ).also { bridge ->
            bridge.setMethodCallHandler { call, result ->
                when (call.method) {
                    "join" -> join(call.arguments as? Map<*, *>, result)
                    "leave" -> shutdownRtc { result.success(null) }
                    "setMuted" -> {
                        val muted = call.argument<Boolean>("muted") ?: false
                        val code = rtcEngine?.muteLocalMic(
                            muted,
                            AliRtcEngine.AliRtcMuteLocalAudioMode.AliRtcMuteOnlyMicAudioMode,
                        ) ?: -1
                        result.success(code)
                    }
                    "setSpeaker" -> {
                        val enabled = call.argument<Boolean>("enabled") ?: true
                        result.success(rtcEngine?.enableSpeakerphone(enabled) ?: -1)
                    }
                    "setTranslationMode" -> {
                        val enabled = call.argument<Boolean>("enabled") ?: false
                        val muteRemoteAudio =
                            call.argument<Boolean>("muteRemoteAudio") ?: enabled
                        setTranslationMode(enabled, muteRemoteAudio)
                        result.success(0)
                    }
                    "playTranslationAudio" -> {
                        val audio = call.argument<ByteArray>("audio")
                        val sampleRate = call.argument<Int>("sampleRate") ?: 24_000
                        if (audio == null || audio.isEmpty() || sampleRate !in 8_000..48_000) {
                            result.error(
                                "INVALID_TRANSLATION_AUDIO",
                                "Translated audio frame is invalid",
                                null,
                            )
                        } else {
                            enqueueTranslationAudio(audio.copyOf(), sampleRate)
                            result.success(0)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
        }
        audioCueChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.tooyei.translator/audio_cues",
        ).also { bridge ->
            bridge.setMethodCallHandler { call, result ->
                when (call.method) {
                    "startRingback" -> {
                        startRingbackTone()
                        result.success(null)
                    }
                    "stopRingback" -> {
                        stopRingbackTone()
                        result.success(null)
                    }
                    "startIncomingRingtone" -> {
                        startIncomingRingtone()
                        result.success(null)
                    }
                    "stopIncomingRingtone" -> {
                        stopIncomingRingtone()
                        result.success(null)
                    }
                    "showIncomingCall" -> {
                        val callId = call.argument<String>("callId")
                        val callerName = call.argument<String>("callerName")
                        val title = call.argument<String>("title")
                        val answerLabel = call.argument<String>("answerLabel")
                        val declineLabel = call.argument<String>("declineLabel")
                        if (listOf(callId, callerName, title, answerLabel, declineLabel)
                                .any { it.isNullOrBlank() }
                        ) {
                            result.error(
                                "INVALID_INCOMING_CALL",
                                "Incoming call notification is incomplete",
                                null,
                            )
                        } else {
                            IncomingCallNotification.show(
                                applicationContext,
                                callId!!,
                                callerName!!,
                                title!!,
                                answerLabel!!,
                                declineLabel!!,
                            )
                            result.success(null)
                        }
                    }
                    "cancelIncomingCall" -> {
                        call.argument<String>("callId")?.let {
                            IncomingCallNotification.cancel(applicationContext, it)
                        }
                        result.success(null)
                    }
                    "consumeIncomingCallAction" -> {
                        val preferences = getSharedPreferences(
                            INCOMING_CALL_PREFERENCES,
                            MODE_PRIVATE,
                        )
                        val action = preferences.getString(INCOMING_CALL_ACTION_KEY, null)
                        val callId = preferences.getString(INCOMING_CALL_ID_KEY, null)
                        preferences.edit()
                            .remove(INCOMING_CALL_ACTION_KEY)
                            .remove(INCOMING_CALL_ID_KEY)
                            .apply()
                        result.success(
                            if (action != null && callId != null) {
                                mapOf("action" to action, "callId" to callId)
                            } else {
                                null
                            },
                        )
                    }
                    "playTalkReady" -> playTalkReadyTone(result)
                    else -> result.notImplemented()
                }
            }
        }
    }

    private fun startRingbackTone() {
        stopRingbackTone()
        // Ringback starts before the RTC engine owns the voice-call route, so
        // use the media stream to keep it audible on normal device settings.
        val tone = try {
            ToneGenerator(AudioManager.STREAM_MUSIC, RINGBACK_VOLUME)
        } catch (_: RuntimeException) {
            return
        }
        ringbackTone = tone
        val pulse = object : Runnable {
            override fun run() {
                if (ringbackTone !== tone) return
                tone.startTone(ToneGenerator.TONE_SUP_RINGTONE, RINGBACK_PULSE_MS)
                mainHandler.postDelayed(this, RINGBACK_INTERVAL_MS)
            }
        }
        ringbackPulse = pulse
        pulse.run()
    }

    private fun stopRingbackTone() {
        ringbackPulse?.let(mainHandler::removeCallbacks)
        ringbackPulse = null
        ringbackTone?.let { tone ->
            try {
                tone.stopTone()
            } catch (_: RuntimeException) {
                // The audio route may already be gone during call teardown.
            }
            releaseTone(tone)
        }
        ringbackTone = null
    }

    private fun startIncomingRingtone() {
        stopIncomingRingtone()
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: return
        incomingRingtone = RingtoneManager.getRingtone(applicationContext, uri)?.also { ringtone ->
            ringtone.audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                ringtone.isLooping = true
            }
            ringtone.play()
        }
    }

    private fun captureIncomingCallAction(intent: Intent?) {
        val callId = intent?.getStringExtra(IncomingCallNotification.EXTRA_CALL_ID)
        val action = intent?.getStringExtra(IncomingCallNotification.EXTRA_ACTION)
        if (callId.isNullOrBlank() || action.isNullOrBlank()) return
        getSharedPreferences(INCOMING_CALL_PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(INCOMING_CALL_ACTION_KEY, action)
            .putString(INCOMING_CALL_ID_KEY, callId)
            .apply()
    }

    private fun stopIncomingRingtone() {
        incomingRingtone?.let { ringtone ->
            try {
                ringtone.stop()
            } catch (_: RuntimeException) {
                // The system audio service may already have reclaimed the ringtone.
            }
        }
        incomingRingtone = null
    }

    private fun playTalkReadyTone(result: MethodChannel.Result) {
        val tone = try {
            ToneGenerator(AudioManager.STREAM_MUSIC, TALK_READY_VOLUME)
        } catch (_: RuntimeException) {
            result.error("TALK_READY_TONE_FAILED", "Unable to create talk-ready tone", null)
            return
        }
        val started = tone.startTone(ToneGenerator.TONE_PROP_BEEP, TALK_READY_DURATION_MS)
        if (!started) {
            releaseTone(tone)
            result.error("TALK_READY_TONE_FAILED", "Unable to play talk-ready tone", null)
            return
        }
        // Complete the Dart future after the beep. Recording/unmute begins
        // only after this callback, making the cue an unambiguous start mark.
        mainHandler.postDelayed({
            releaseTone(tone)
            result.success(null)
        }, TALK_READY_DURATION_MS.toLong())
    }

    private fun releaseTone(tone: ToneGenerator) {
        try {
            tone.release()
        } catch (_: RuntimeException) {
            // Already released by the platform audio service.
        }
    }

    private fun join(arguments: Map<*, *>?, result: MethodChannel.Result) {
        val channelId = arguments?.get("channelId") as? String
        val userId = arguments?.get("userId") as? String
        val token = arguments?.get("token") as? String
        val displayName = arguments?.get("displayName") as? String
        if (listOf(channelId, userId, token, displayName).any { it.isNullOrBlank() }) {
            result.error("INVALID_RTC_CREDENTIAL", "RTC credential is incomplete", null)
            return
        }
        shutdownRtc {
            startJoin(channelId!!, userId!!, token!!, displayName!!, result)
        }
    }

    private fun startJoin(
        channelId: String,
        userId: String,
        token: String,
        displayName: String,
        result: MethodChannel.Result,
    ) {
        val engine = AliRtcEngine.getInstance(applicationContext, "")
        rtcEngine = engine
        translationCaptureEnabled = false
        resetTranslationCaptureBuffer()
        engine.setAudioOnlyMode(true)
        engine.setDefaultSubscribeAllRemoteVideoStreams(false)
        engine.setDefaultSubscribeAllRemoteAudioStreams(true)
        engine.setDefaultAudioRoutetoSpeakerphone(true)
        engine.registerAudioFrameObserver(object : AliRtcEngine.AliRtcAudioFrameObserver {
            override fun onCapturedAudioFrame(frame: AliRtcEngine.AliRtcAudioFrame): Boolean = true

            override fun onProcessCapturedAudioFrame(
                frame: AliRtcEngine.AliRtcAudioFrame,
            ): Boolean {
                captureTranslationAudio(frame)
                return true
            }

            override fun onPublishAudioFrame(frame: AliRtcEngine.AliRtcAudioFrame): Boolean = true

            override fun onPlaybackAudioFrame(frame: AliRtcEngine.AliRtcAudioFrame): Boolean = true

            override fun onMixedAllAudioFrame(frame: AliRtcEngine.AliRtcAudioFrame): Boolean = true

            override fun onRemoteUserAudioFrame(
                userId: String?,
                frame: AliRtcEngine.AliRtcAudioFrame,
            ): Boolean = true
        })
        val observerConfig = AliRtcEngine.AliRtcAudioFrameObserverConfig().apply {
            sampleRate = AliRtcEngine.AliRtcAudioSampleRate.AliRtcAudioSampleRate_16000
            channels = AliRtcEngine.AliRtcAudioNumChannel.AliRtcMonoAudio
            mode = AliRtcEngine.AliRtcAudioFrameObserverOperationMode
                .AliRtcAudioDataObserverOperationModeReadOnly
            userDefinedInfo = 0
        }
        engine.enableAudioFrameObserver(
            true,
            AliRtcEngine.AliRtcAudioSource.AliRtcAudioSourceProcessCaptured,
            observerConfig,
        )
        engine.setRtcEngineEventListener(object : AliRtcEngineEventListener() {
            override fun onJoinChannelResult(resultCode: Int, channelName: String?, joinedUserId: String?, elapsed: Int) {
                runOnUiThread {
                    if (resultCode == 0) {
                        engine.requestAudioFocus()
                        engine.publishLocalAudioStream(true)
                    }
                    channel?.invokeMethod(
                        "state",
                        mapOf(
                            "state" to if (resultCode == 0) "joined" else "error",
                            "code" to resultCode,
                            "phase" to "join",
                        ),
                    )
                }
            }

            override fun onLeaveChannelResult(resultCode: Int, stats: AliRtcEngine.AliRtcStats?) {
                mainHandler.post { finishDestroy(engine) }
            }

            override fun onConnectionLost() {
                runOnUiThread { channel?.invokeMethod("state", mapOf("state" to "reconnecting")) }
            }

            override fun onConnectionRecovery() {
                runOnUiThread { channel?.invokeMethod("state", mapOf("state" to "joined")) }
            }

            override fun onOccurError(error: Int, message: String?) {
                runOnUiThread {
                    channel?.invokeMethod(
                        "state",
                        mapOf(
                            "state" to "error",
                            "code" to error,
                            "message" to message,
                            "phase" to "runtime",
                        ),
                    )
                }
            }
        })
        val code = engine.joinChannel(token, channelId, userId, displayName)
        if (code != 0) {
            shutdownRtc {
                result.error("RTC_JOIN_REJECTED", "RTC SDK rejected join request", code)
            }
            return
        }
        result.success(code)
    }

    private fun setTranslationMode(enabled: Boolean, muteRemoteAudio: Boolean = enabled) {
        translationCaptureEnabled = enabled
        rtcEngine?.muteAllRemoteAudioPlaying(enabled && muteRemoteAudio)
        if (!enabled) {
            resetTranslationCaptureBuffer()
            stopTranslationAudio()
        }
    }

    private fun captureTranslationAudio(frame: AliRtcEngine.AliRtcAudioFrame) {
        if (!translationCaptureEnabled || frame.sampleRate != 16_000 || frame.numChannels != 1) {
            return
        }
        val data = frame.data ?: return
        val size = min(frame.dataSize.takeIf { it > 0 } ?: data.size, data.size)
        if (size <= 0) return
        val chunks = mutableListOf<ByteArray>()
        synchronized(translationCaptureLock) {
            translationCaptureBuffer.write(data, 0, size)
            val buffered = translationCaptureBuffer.toByteArray()
            var offset = 0
            while (buffered.size - offset >= TRANSLATION_CAPTURE_CHUNK_BYTES) {
                chunks.add(
                    buffered.copyOfRange(
                        offset,
                        offset + TRANSLATION_CAPTURE_CHUNK_BYTES,
                    ),
                )
                offset += TRANSLATION_CAPTURE_CHUNK_BYTES
            }
            translationCaptureBuffer.reset()
            if (offset < buffered.size) {
                translationCaptureBuffer.write(buffered, offset, buffered.size - offset)
            }
        }
        for (chunk in chunks) {
            mainHandler.post {
                if (translationCaptureEnabled) {
                    channel?.invokeMethod("audioFrame", chunk)
                }
            }
        }
    }

    private fun resetTranslationCaptureBuffer() {
        synchronized(translationCaptureLock) {
            translationCaptureBuffer.reset()
        }
    }

    private fun enqueueTranslationAudio(audio: ByteArray, sampleRate: Int) {
        if (!translationCaptureEnabled) return
        translationPlaybackExecutor.execute {
            synchronized(translationPlaybackLock) {
                if (!translationCaptureEnabled) return@execute
                val track = ensureTranslationAudioTrack(sampleRate) ?: return@execute
                if (track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()
                track.write(audio, 0, audio.size, AudioTrack.WRITE_BLOCKING)
            }
        }
    }

    private fun ensureTranslationAudioTrack(sampleRate: Int): AudioTrack? {
        val current = translationAudioTrack
        if (
            current != null &&
            current.state == AudioTrack.STATE_INITIALIZED &&
            translationAudioSampleRate == sampleRate
        ) {
            return current
        }
        releaseTranslationAudioTrack()
        val minimumBuffer = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minimumBuffer <= 0) return null
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(maxOf(minimumBuffer * 4, 19_200))
            .setSessionId(AudioManager.AUDIO_SESSION_ID_GENERATE)
            .build()
        if (track.state != AudioTrack.STATE_INITIALIZED) {
            track.release()
            return null
        }
        translationAudioTrack = track
        translationAudioSampleRate = sampleRate
        return track
    }

    private fun stopTranslationAudio() {
        synchronized(translationPlaybackLock) {
            releaseTranslationAudioTrack()
        }
    }

    private fun releaseTranslationAudioTrack() {
        translationAudioTrack?.let { track ->
            try {
                track.pause()
                track.flush()
                track.stop()
            } catch (_: IllegalStateException) {
                // The stream may already be stopped while the RTC engine exits.
            }
            track.release()
        }
        translationAudioTrack = null
        translationAudioSampleRate = 0
    }

    private fun shutdownRtc(onComplete: (() -> Unit)? = null) {
        if (onComplete != null) shutdownCallbacks.add(onComplete)
        val engine = rtcEngine
        if (engine == null) {
            drainShutdownCallbacks()
            return
        }
        if (shuttingDown) return
        shuttingDown = true
        setTranslationMode(false)
        engine.abandonAudioFocus()
        if (engine.isInCall && engine.leaveChannel() == 0) {
            val timeout = Runnable { finishDestroy(engine) }
            leaveTimeout = timeout
            mainHandler.postDelayed(timeout, 3_000)
            return
        }
        finishDestroy(engine)
    }

    private fun finishDestroy(engine: AliRtcEngine) {
        if (rtcEngine !== engine || destroyingEngine === engine) return
        destroyingEngine = engine
        leaveTimeout?.let(mainHandler::removeCallbacks)
        leaveTimeout = null
        engine.destroy(object : AliRtcEngine.AliRtcDestroyCompletionObserver {
            override fun OnDestroyCompletion() {
                mainHandler.post {
                    if (rtcEngine === engine) rtcEngine = null
                    if (destroyingEngine === engine) destroyingEngine = null
                    shuttingDown = false
                    drainShutdownCallbacks()
                }
            }
        })
    }

    private fun drainShutdownCallbacks() {
        val callbacks = shutdownCallbacks.toList()
        shutdownCallbacks.clear()
        callbacks.forEach { callback -> callback() }
    }

    override fun onDestroy() {
        channel?.setMethodCallHandler(null)
        channel = null
        audioCueChannel?.setMethodCallHandler(null)
        audioCueChannel = null
        stopRingbackTone()
        stopIncomingRingtone()
        shutdownRtc()
        translationPlaybackExecutor.shutdownNow()
        super.onDestroy()
    }

    private companion object {
        const val TRANSLATION_CAPTURE_CHUNK_BYTES = 3_200
        const val RINGBACK_VOLUME = 55
        const val RINGBACK_PULSE_MS = 1_000
        const val RINGBACK_INTERVAL_MS = 3_000L
        const val TALK_READY_VOLUME = 80
        const val TALK_READY_DURATION_MS = 180
        const val INCOMING_CALL_PREFERENCES = "incoming_call_actions"
        const val INCOMING_CALL_ACTION_KEY = "action"
        const val INCOMING_CALL_ID_KEY = "call_id"
    }
}
