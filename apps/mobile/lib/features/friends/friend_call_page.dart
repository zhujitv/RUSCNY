import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/audio/audio_cue_service.dart';
import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import 'rtc_voice_service.dart';
import 'social_realtime_controller.dart';

final class FriendCallPage extends ConsumerStatefulWidget {
  const FriendCallPage({required this.initialCall, super.key});

  final FriendCallModel initialCall;

  @override
  ConsumerState<FriendCallPage> createState() => _FriendCallPageState();
}

final class _FriendCallPageState extends ConsumerState<FriendCallPage> {
  late FriendCallModel _call;
  late final RtcVoiceService _rtc;
  StreamSubscription<RtcVoiceState>? _rtcSubscription;
  StreamSubscription<Uint8List>? _audioFrameSubscription;
  StreamSubscription<FriendCallTranslationEvent>? _translationEventSubscription;
  String _connectionState = '等待对方接听';
  bool _joining = false;
  bool _muted = false;
  bool _speaker = true;
  bool _ending = false;
  bool _handlingRtcFailure = false;
  bool _rtcJoinFailed = false;
  Timer? _ringTimeout;
  Timer? _heartbeatTimer;
  int _heartbeatFailures = 0;
  RtcCredential? _credential;
  bool _translationStarting = false;
  bool _translationEnabled = false;
  bool _playTranslatedAudio = true;
  bool _translatedAudioActivated = false;
  String _translationStatus = '实时翻译等待通话连接';
  String _sourceText = '';
  String _translatedText = '';
  String _sourceLanguage = 'zh';
  String _targetLanguage = 'ru';
  int _audioSequence = 0;

  @override
  void initState() {
    super.initState();
    _call = widget.initialCall;
    _playTranslatedAudio = ref
            .read(authControllerProvider)
            .valueOrNull
            ?.autoPlayTranslationAudio ??
        true;
    _rtc = RtcVoiceService();
    _audioFrameSubscription = _rtc.audioFrames.listen(_sendTranslationAudio);
    _translationEventSubscription = ref
        .read(socialRealtimeProvider.notifier)
        .callTranslationEvents
        .listen(_handleTranslationEvent);
    _rtcSubscription = _rtc.states.listen((state) {
      if (!mounted) return;
      setState(() {
        _connectionState = switch (state.value) {
          'joined' => '通话中',
          'reconnecting' => '网络波动，正在重连',
          'error' => state.userMessage,
          _ => _connectionState,
        };
        if (state.isJoined) _rtcJoinFailed = false;
      });
      if (state.isJoined) {
        unawaited(AudioCueService.stopRingback());
        unawaited(_startRealtimeTranslation());
      }
      if (state.isError && !_ending && !_handlingRtcFailure) {
        unawaited(_handleRtcFailure(state.userMessage));
      }
    });
    if (_call.isActive) {
      unawaited(AudioCueService.stopRingback());
      unawaited(_joinRtc());
    }
    if (_call.isRinging) {
      unawaited(AudioCueService.startRingback());
      // Recover an acceptance event that may have arrived between the REST
      // response and this route being mounted.
      unawaited(_refreshAndJoin());
      _ringTimeout = Timer(const Duration(seconds: 60), () {
        if (mounted && _call.isRinging) unawaited(_endAndClose());
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<bool>(
      socialRealtimeProvider.select((state) => state.connected),
      (previous, connected) {
        if (!connected && _translationEnabled) {
          _disableRealtimeTranslation('实时连接中断，已恢复原声通话');
        } else if (connected && previous == false && _call.isActive) {
          unawaited(_startRealtimeTranslation());
        }
      },
    );
    ref.listen<int>(
      socialRealtimeProvider.select((state) => state.revision),
      (previous, next) {
        final event = ref.read(socialRealtimeProvider).lastEvent;
        if (event == 'friend.call.accepted') {
          unawaited(_refreshAndJoin());
        } else if (event == 'friend.call.declined' ||
            event == 'friend.call.ended') {
          unawaited(_remoteEnded(
              event == 'friend.call.declined' ? '对方已拒绝' : '通话已结束'));
        }
      },
    );
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_endAndClose());
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0B4338),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 36),
            child: Column(
              children: [
                const Spacer(),
                CircleAvatar(
                  radius: 54,
                  backgroundColor: Colors.white.withValues(alpha: .14),
                  child: AppText(
                    _call.peer.displayName.characters.first,
                    translate: false,
                    style: const TextStyle(fontSize: 40, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 24),
                AppText(
                  _call.peer.displayName,
                  translate: false,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const SizedBox(height: 10),
                AppText(
                  _connectionState,
                  style: const TextStyle(color: Color(0xFFC5DAD4)),
                ),
                if (_call.isActive && _rtcJoinFailed) ...[
                  const SizedBox(height: 14),
                  FilledButton.tonalIcon(
                    onPressed: _joining ? null : _joinRtc,
                    icon: const Icon(Icons.refresh),
                    label: const AppText('重新连接'),
                  ),
                ],
                const SizedBox(height: 18),
                _TranslationPanel(
                  enabled: _translationEnabled,
                  status: _translationStatus,
                  sourceText: _sourceText,
                  translatedText: _translatedText,
                  sourceLanguage: _sourceLanguage,
                  targetLanguage: _targetLanguage,
                ),
                const Spacer(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _RoundCallButton(
                      icon: _muted ? Icons.mic_off : Icons.mic,
                      label: _muted ? '取消静音' : '静音',
                      onPressed: _call.isActive ? _toggleMute : null,
                    ),
                    _RoundCallButton(
                      icon: Icons.call_end,
                      label: '挂断',
                      destructive: true,
                      onPressed: _ending ? null : _endAndClose,
                    ),
                    _RoundCallButton(
                      icon: _speaker ? Icons.volume_up : Icons.hearing,
                      label: _speaker ? '扬声器' : '听筒',
                      onPressed: _call.isActive ? _toggleSpeaker : null,
                    ),
                  ],
                ),
                const SizedBox(height: 32),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _refreshAndJoin() async {
    try {
      final active = await ref.read(friendRepositoryProvider).activeCall();
      if (!mounted ||
          active == null ||
          active.id != _call.id ||
          !active.isActive) {
        return;
      }
      setState(() => _call = active);
      _ringTimeout?.cancel();
      await AudioCueService.stopRingback();
      await _joinRtc();
    } catch (error) {
      if (mounted) setState(() => _connectionState = readableError(error));
    }
  }

  Future<void> _joinRtc() async {
    if (_joining || !_call.isActive) return;
    _joining = true;
    _startHeartbeat();
    if (mounted) {
      setState(() {
        _rtcJoinFailed = false;
        _connectionState = '正在连接';
      });
    }
    try {
      final permission = await Permission.microphone.request();
      if (!permission.isGranted) {
        throw const AppException('需要麦克风权限才能进行语音通话');
      }
      final credential =
          await ref.read(friendRepositoryProvider).rtcCredential(_call.id);
      _credential = credential;
      final session = ref.read(authControllerProvider).valueOrNull;
      await _rtc.join(credential, session?.displayName ?? '用户');
    } catch (error) {
      await _handleRtcFailure(readableError(error));
    } finally {
      _joining = false;
    }
  }

  Future<void> _startRealtimeTranslation() async {
    if (_translationStarting || _translationEnabled || !_call.isActive) return;
    final credential = _credential;
    if (credential == null || !credential.realtimeTranslationAvailable) {
      if (mounted) {
        setState(() {
          _translationStatus = '实时翻译未配置，当前为原声通话';
        });
      }
      return;
    }
    _translationStarting = true;
    if (mounted) setState(() => _translationStatus = '正在连接实时翻译');
    try {
      final ready = await ref
          .read(socialRealtimeProvider.notifier)
          .startCallTranslation(_call.id);
      await _rtc.setTranslationMode(
        true,
        // Keep the original remote voice until the first translated PCM chunk
        // arrives. This preserves audio when the peer is still connecting or
        // is running an older client that cannot upload translation audio.
        muteRemoteAudio: false,
      );
      if (!mounted) return;
      setState(() {
        _translationEnabled = true;
        _sourceLanguage = ready.sourceLanguage ?? _sourceLanguage;
        _targetLanguage = ready.targetLanguage ?? _targetLanguage;
        _translationStatus =
            !_playTranslatedAudio ? '实时字幕已开启，译音频按个人偏好关闭' : '中俄实时翻译已开启';
      });
    } catch (error) {
      ref.read(socialRealtimeProvider.notifier).finishCallTranslation(_call.id);
      await _rtc.setTranslationMode(false);
      if (mounted) {
        setState(() {
          _translationEnabled = false;
          _translationStatus = readableError(error);
        });
      }
    } finally {
      _translationStarting = false;
    }
  }

  void _sendTranslationAudio(Uint8List audio) {
    if (!_translationEnabled || audio.isEmpty || _ending) return;
    ref.read(socialRealtimeProvider.notifier).sendCallTranslationAudio(
          _call.id,
          base64Encode(audio),
          _audioSequence++,
        );
  }

  void _handleTranslationEvent(FriendCallTranslationEvent event) {
    if (!mounted || event.callId != _call.id) return;
    switch (event.type) {
      case 'source.partial':
      case 'source.final':
        if (event.text?.isNotEmpty == true) {
          setState(() {
            _sourceText = event.text!;
            _sourceLanguage = event.language ?? _sourceLanguage;
          });
        }
        break;
      case 'translation.partial':
      case 'translation.final':
        if (event.text?.isNotEmpty == true) {
          setState(() {
            _translatedText = event.text!;
            _targetLanguage = event.language ?? _targetLanguage;
          });
        }
        break;
      case 'friend.call.translation.audio':
        if (!_translationEnabled ||
            !_playTranslatedAudio ||
            event.audio?.isNotEmpty != true) {
          return;
        }
        unawaited(_playTranslationAudioEvent(event));
        break;
      case 'friend.call.translation.error':
        _disableRealtimeTranslation(
          event.message ?? '实时翻译服务暂时不可用，已恢复原声通话',
        );
        break;
      case 'friend.call.translation.finished':
        _disableRealtimeTranslation('实时翻译已结束，当前为原声通话');
        break;
      default:
        break;
    }
  }

  void _disableRealtimeTranslation(String message) {
    if (!_translationEnabled && !_translationStarting) {
      if (mounted) setState(() => _translationStatus = message);
      return;
    }
    _translationEnabled = false;
    _translationStarting = false;
    _translatedAudioActivated = false;
    ref.read(socialRealtimeProvider.notifier).finishCallTranslation(_call.id);
    unawaited(_rtc.setTranslationMode(false));
    if (mounted) setState(() => _translationStatus = message);
  }

  Future<void> _playTranslationAudioEvent(
    FriendCallTranslationEvent event,
  ) async {
    try {
      final audio = base64Decode(event.audio!);
      if (!_translatedAudioActivated) {
        _translatedAudioActivated = true;
        await _rtc.setTranslationMode(true, muteRemoteAudio: true);
      }
      await _rtc.playTranslationAudio(audio, event.sampleRate ?? 24000);
    } catch (_) {
      _disableRealtimeTranslation('译音频播放失败，已恢复原声通话');
    }
  }

  Future<void> _toggleMute() async {
    final next = !_muted;
    if (!next) {
      // Keep the mic muted until the user hears that capture is ready.
      await AudioCueService.playTalkReady();
      if (!mounted || !_call.isActive || _ending) return;
    }
    await _rtc.setMuted(next);
    if (mounted) setState(() => _muted = next);
  }

  Future<void> _toggleSpeaker() async {
    final next = !_speaker;
    await _rtc.setSpeaker(next);
    if (mounted) setState(() => _speaker = next);
  }

  Future<void> _remoteEnded(String message) async {
    _heartbeatTimer?.cancel();
    await AudioCueService.stopRingback();
    ref.read(socialRealtimeProvider.notifier).finishCallTranslation(_call.id);
    _translationEnabled = false;
    await _rtc.setTranslationMode(false);
    await _rtc.leave();
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: AppText(message)));
    Navigator.pop(context);
  }

  Future<void> _endAndClose() async {
    if (_ending) return;
    setState(() => _ending = true);
    _heartbeatTimer?.cancel();
    await AudioCueService.stopRingback();
    ref.read(socialRealtimeProvider.notifier).finishCallTranslation(_call.id);
    _translationEnabled = false;
    try {
      await ref.read(friendRepositoryProvider).endCall(_call.id);
    } catch (_) {
      // Local audio must still stop when the server already ended the call.
    }
    await _rtc.leave();
    if (mounted) Navigator.pop(context);
  }

  void _startHeartbeat() {
    if (_heartbeatTimer?.isActive == true) return;
    _heartbeatFailures = 0;
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      unawaited(_sendHeartbeat());
    });
  }

  Future<void> _sendHeartbeat() async {
    try {
      await ref.read(friendRepositoryProvider).heartbeatCall(_call.id);
      _heartbeatFailures = 0;
    } catch (_) {
      _heartbeatFailures += 1;
      if (_heartbeatFailures >= 3 && mounted) {
        await _remoteEnded('通话连接已失效');
      }
    }
  }

  Future<void> _handleRtcFailure(String message) async {
    if (_handlingRtcFailure || _ending) return;
    _handlingRtcFailure = true;
    await AudioCueService.stopRingback();
    ref.read(socialRealtimeProvider.notifier).finishCallTranslation(_call.id);
    _translationEnabled = false;
    try {
      await _rtc.leave();
    } catch (_) {
      // A failed native join may already have disposed the engine.
    }
    if (mounted) {
      setState(() {
        _rtcJoinFailed = true;
        _connectionState = message;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: AppText(message)),
      );
    }
    _handlingRtcFailure = false;
  }

  @override
  void dispose() {
    unawaited(_rtcSubscription?.cancel());
    unawaited(_audioFrameSubscription?.cancel());
    unawaited(_translationEventSubscription?.cancel());
    _ringTimeout?.cancel();
    _heartbeatTimer?.cancel();
    unawaited(AudioCueService.stopRingback());
    ref.read(socialRealtimeProvider.notifier).finishCallTranslation(_call.id);
    unawaited(_rtc.dispose());
    super.dispose();
  }
}

final class _TranslationPanel extends StatelessWidget {
  const _TranslationPanel({
    required this.enabled,
    required this.status,
    required this.sourceText,
    required this.translatedText,
    required this.sourceLanguage,
    required this.targetLanguage,
  });

  final bool enabled;
  final String status;
  final String sourceText;
  final String translatedText;
  final String sourceLanguage;
  final String targetLanguage;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 82),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white.withValues(alpha: .12)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  enabled ? Icons.translate : Icons.graphic_eq,
                  size: 17,
                  color: enabled
                      ? const Color(0xFFD8F27B)
                      : const Color(0xFFB2C7C1),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: AppText(
                    status,
                    style: const TextStyle(
                      color: Color(0xFFD7E5E1),
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
            if (sourceText.isNotEmpty) ...[
              const SizedBox(height: 12),
              _TranslationLine(
                language: sourceLanguage,
                label: sourceLanguage == 'ru' ? '俄文原文' : '中文原文',
                text: sourceText,
                muted: true,
              ),
            ],
            if (translatedText.isNotEmpty) ...[
              const SizedBox(height: 8),
              _TranslationLine(
                language: targetLanguage,
                label: targetLanguage == 'ru' ? '俄文译文' : '中文译文',
                text: translatedText,
                muted: false,
              ),
            ],
          ],
        ),
      );
}

final class _TranslationLine extends StatelessWidget {
  const _TranslationLine({
    required this.language,
    required this.label,
    required this.text,
    required this.muted,
  });

  final String language;
  final String label;
  final String text;
  final bool muted;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(language == 'ru' ? '🇷🇺' : '🇨🇳'),
          const SizedBox(width: 6),
          SizedBox(
            width: 62,
            child: AppText(
              label,
              style: TextStyle(
                color: Colors.white.withValues(alpha: .65),
                fontSize: 12,
              ),
            ),
          ),
          Expanded(
            child: AppText(
              text,
              translate: false,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: muted ? const Color(0xFFCAD9D5) : Colors.white,
                fontSize: 15,
                height: 1.35,
                fontWeight: muted ? FontWeight.w400 : FontWeight.w600,
              ),
            ),
          ),
        ],
      );
}

final class _RoundCallButton extends StatelessWidget {
  const _RoundCallButton({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool destructive;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          IconButton.filled(
            onPressed: onPressed,
            style: IconButton.styleFrom(
              fixedSize: const Size.square(64),
              backgroundColor: destructive
                  ? const Color(0xFFE65353)
                  : Colors.white.withValues(alpha: .16),
              disabledBackgroundColor: Colors.white.withValues(alpha: .08),
              foregroundColor: Colors.white,
            ),
            icon: Icon(icon, size: 28),
          ),
          const SizedBox(height: 8),
          AppText(label, style: const TextStyle(color: Colors.white)),
        ],
      );
}
