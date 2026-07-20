import 'dart:async';
import 'dart:developer' as developer;
import 'dart:io';
import 'package:flutter/services.dart';

import '../../core/errors.dart';
import '../../core/models.dart';

final class RtcVoiceState {
  const RtcVoiceState({
    required this.value,
    this.code,
    this.message,
    this.phase,
    this.category,
  });

  final String value;
  final int? code;
  final String? message;
  final String? phase;
  final String? category;

  bool get isJoined => value == 'joined';
  bool get isError => value == 'error';

  String get userMessage {
    if (!isError) return value;
    if (category == 'authentication' ||
        category == 'credential' ||
        phase == 'sync_join' ||
        phase == 'preflight') {
      return '语音服务鉴权失败，请重新拨打';
    }
    if (category == 'account') return '语音服务账号不可用，请联系管理员';
    if (category == 'network') return '语音网络连接失败，请检查网络后重试';
    return '语音连接失败，请重试';
  }
}

String rtcJoinFailureMessage(PlatformException error) => switch (error.code) {
      'RTC_JOIN_REJECTED' || 'INVALID_RTC_CREDENTIAL' => '语音服务鉴权失败，请重新拨打',
      _ => '语音连接失败，请重试',
    };

final class RtcVoiceService {
  RtcVoiceService() {
    _owner = this;
    _channel.setMethodCallHandler(_handleNativeCall);
  }

  static const _channel = MethodChannel('com.tooyei.translator/rtc');
  static RtcVoiceService? _owner;
  final _states = StreamController<RtcVoiceState>.broadcast();
  final _audioFrames = StreamController<Uint8List>.broadcast();

  Stream<RtcVoiceState> get states => _states.stream;
  Stream<Uint8List> get audioFrames => _audioFrames.stream;

  Future<void> join(RtcCredential credential, String displayName) async {
    if (!Platform.isAndroid) {
      throw const AppException('当前版本先支持 Android 实时语音通话');
    }
    if (credential.expiresAt <= DateTime.now().millisecondsSinceEpoch ~/ 1000) {
      throw const AppException('RTC 鉴权已过期，请重新拨打');
    }
    try {
      await _channel.invokeMethod<int>('join', {
        ...credential.toJson(),
        'displayName': displayName,
      });
    } on PlatformException catch (error) {
      final details = error.details;
      final phase = details is Map ? details['phase']?.toString() : null;
      final rawCode = details is Map ? details['code']?.toString() : null;
      developer.log(
        'join rejected phase=${phase ?? 'unknown'} code=${rawCode ?? 'unavailable'}',
        name: 'rtc.voice',
      );
      throw AppException(
        rtcJoinFailureMessage(error),
        code: error.code == 'RTC_JOIN_REJECTED' ||
                error.code == 'INVALID_RTC_CREDENTIAL'
            ? 'RTC_AUTH_FAILED'
            : 'RTC_JOIN_FAILED',
      );
    }
  }

  Future<void> leave() => _channel.invokeMethod<void>('leave');
  Future<void> setMuted(bool muted) =>
      _channel.invokeMethod<int>('setMuted', {'muted': muted});
  Future<void> setSpeaker(bool enabled) =>
      _channel.invokeMethod<int>('setSpeaker', {'enabled': enabled});
  Future<void> setTranslationMode(
    bool enabled, {
    bool muteRemoteAudio = true,
  }) =>
      _channel.invokeMethod<int>('setTranslationMode', {
        'enabled': enabled,
        'muteRemoteAudio': enabled && muteRemoteAudio,
      });
  Future<void> playTranslationAudio(Uint8List audio, int sampleRate) =>
      _channel.invokeMethod<int>('playTranslationAudio', {
        'audio': audio,
        'sampleRate': sampleRate,
      });

  Future<void> _handleNativeCall(MethodCall call) async {
    if (call.method == 'audioFrame') {
      final audio = call.arguments;
      if (audio is Uint8List && audio.isNotEmpty) _audioFrames.add(audio);
      return;
    }
    if (call.method == 'state' && call.arguments is Map) {
      final arguments = call.arguments as Map;
      final state = arguments['state']?.toString();
      if (state != null) {
        final code = switch (arguments['code']) {
          final int value => value,
          final num value => value.toInt(),
          _ => null,
        };
        final phase = arguments['phase']?.toString();
        final category = arguments['category']?.toString();
        if (state == 'error') {
          developer.log(
            'native state error phase=${phase ?? 'unknown'} '
            'category=${category ?? 'unknown'} code=${code ?? 'unavailable'}',
            name: 'rtc.voice',
          );
        }
        _states.add(
          RtcVoiceState(
            value: state,
            code: code,
            message: arguments['message']?.toString(),
            phase: phase,
            category: category,
          ),
        );
      }
    }
  }

  Future<void> dispose() async {
    if (identical(_owner, this)) {
      await leave();
      _owner = null;
      _channel.setMethodCallHandler(null);
    }
    await _states.close();
    await _audioFrames.close();
  }
}
