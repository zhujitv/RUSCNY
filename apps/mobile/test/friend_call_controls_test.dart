import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/errors.dart';
import 'package:tooyei_translator/core/localization/app_localization.dart';
import 'package:tooyei_translator/features/friends/friend_call_page.dart';

void main() {
  test('translation recovery uses bounded exponential backoff', () {
    expect(friendCallTranslationRecoveryDelay(0), const Duration(seconds: 1));
    expect(friendCallTranslationRecoveryDelay(1), const Duration(seconds: 1));
    expect(friendCallTranslationRecoveryDelay(2), const Duration(seconds: 2));
    expect(friendCallTranslationRecoveryDelay(3), const Duration(seconds: 4));
    expect(friendCallTranslationRecoveryDelay(4), const Duration(seconds: 8));
    expect(friendCallTranslationRecoveryDelay(5), const Duration(seconds: 15));
    expect(friendCallTranslationRecoveryDelay(6), const Duration(seconds: 30));
    expect(friendCallTranslationRecoveryDelay(7), const Duration(seconds: 60));
    expect(friendCallTranslationRecoveryDelay(20), const Duration(seconds: 60));
  });

  test('translation only retries while the live peer call can receive it', () {
    bool canRecover({
      bool ending = false,
      bool callActive = true,
      bool rtcJoined = true,
      bool peerPresent = true,
    }) =>
        canRecoverFriendCallTranslation(
          ending: ending,
          callActive: callActive,
          rtcJoined: rtcJoined,
          peerPresent: peerPresent,
        );

    expect(canRecover(), isTrue);
    expect(canRecover(ending: true), isFalse);
    expect(canRecover(callActive: false), isFalse);
    expect(canRecover(rtcJoined: false), isFalse);
    expect(canRecover(peerPresent: false), isFalse);
  });

  test('translation retries transient failures but not permanent call errors',
      () {
    expect(
      isRetryableFriendCallTranslationError(
        const AppException(
          'temporary',
          code: 'REALTIME_TRANSLATION_FAILED',
        ),
      ),
      isTrue,
    );
    expect(
      isRetryableFriendCallTranslationError(
        const AppException(
          'not configured',
          code: 'REALTIME_TRANSLATION_NOT_CONFIGURED',
        ),
      ),
      isFalse,
    );
    expect(
      isRetryableFriendCallTranslationError(
        const AppException(
          'ended',
          code: 'ACTIVE_FRIEND_CALL_NOT_FOUND',
        ),
      ),
      isFalse,
    );
    expect(
      isRetryableFriendCallTranslationError(
        PlatformException(code: 'UNEXPECTED_PLATFORM_FAILURE'),
      ),
      isFalse,
    );
  });

  test('translated playback diagnostics preserve platform error codes', () {
    expect(
      friendCallTranslationPlaybackErrorCode(
        PlatformException(code: 'INVALID_TRANSLATION_AUDIO'),
      ),
      'INVALID_TRANSLATION_AUDIO',
    );
    expect(
      friendCallTranslationPlaybackErrorCode(
        const AppException('failed',
            code: 'RTC_TRANSLATION_AUDIO_PLAYBACK_FAILED'),
      ),
      'RTC_TRANSLATION_AUDIO_PLAYBACK_FAILED',
    );
  });

  test('translated audio playback queue preserves order across async setup',
      () async {
    final queue = FriendCallTranslationAudioQueue();
    final order = <String>[];
    final firstReady = Completer<void>();

    final first = queue.enqueue((generation) async {
      order.add('first:mode');
      await firstReady.future;
      if (queue.isCurrent(generation)) order.add('first:play');
    });
    final second = queue.enqueue((generation) async {
      if (queue.isCurrent(generation)) order.add('second:play');
    });
    await Future<void>.delayed(Duration.zero);
    expect(order, ['first:mode']);

    firstReady.complete();
    await Future.wait([first, second]);
    expect(order, ['first:mode', 'first:play', 'second:play']);
  });

  test('translated audio playback queue discards a stale generation', () async {
    final queue = FriendCallTranslationAudioQueue();
    final played = <String>[];
    final firstReady = Completer<void>();

    final first = queue.enqueue((generation) async {
      await firstReady.future;
      if (queue.isCurrent(generation)) played.add('stale');
    });
    final staleQueued = queue.enqueue((generation) async {
      if (queue.isCurrent(generation)) played.add('queued-stale');
    });
    await Future<void>.delayed(Duration.zero);
    queue.invalidate();
    firstReady.complete();
    await Future.wait([first, staleQueued]);

    await queue.enqueue((generation) async {
      if (queue.isCurrent(generation)) played.add('current');
    });
    expect(played, ['current']);
  });

  test('translation-ready status distinguishes audio, fallback, and preference',
      () {
    expect(
      friendCallTranslationReadyStatus(
        prefersTranslatedAudio: true,
        outputAudio: true,
      ),
      '中俄实时翻译已开启',
    );
    expect(
      friendCallTranslationReadyStatus(
        prefersTranslatedAudio: true,
        outputAudio: false,
      ),
      '实时字幕已开启，译音频暂时不可用',
    );
    expect(
      friendCallTranslationReadyStatus(
        prefersTranslatedAudio: false,
        outputAudio: false,
      ),
      '实时字幕已开启，译音频按个人偏好关闭',
    );
  });

  test('remote call cleanup always attempts server end and absorbs failure',
      () async {
    var attempts = 0;

    await endFriendCallOnServerBestEffort(() async {
      attempts += 1;
      throw Exception('already ended');
    });

    expect(attempts, 1);
  });

  test('camera suspension covers joined and joining video calls', () {
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.inactive,
        rtcJoined: true,
        isVideo: true,
        cameraEnabled: true,
      ),
      isTrue,
    );
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.paused,
        rtcJoined: true,
        isVideo: true,
        cameraEnabled: true,
      ),
      isTrue,
    );
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.hidden,
        rtcJoined: true,
        isVideo: true,
        cameraEnabled: true,
      ),
      isTrue,
    );
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.detached,
        rtcJoined: true,
        isVideo: true,
        cameraEnabled: true,
      ),
      isTrue,
    );
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.resumed,
        rtcJoined: true,
        isVideo: true,
        cameraEnabled: true,
      ),
      isFalse,
    );
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.paused,
        rtcJoined: false,
        isVideo: true,
        cameraEnabled: true,
      ),
      isFalse,
    );
    expect(
      shouldSuspendRtcCamera(
        lifecycleState: AppLifecycleState.paused,
        rtcJoined: false,
        rtcJoining: true,
        isVideo: true,
        cameraEnabled: true,
      ),
      isTrue,
    );
  });

  test('only a manual camera-off operation cancels lifecycle restoration', () {
    expect(
      shouldRestoreRtcCameraAfterResume(
        cameraEnabled: true,
        operationTargetEnabled: false,
        operationIsUserInitiated: true,
      ),
      isFalse,
    );
    expect(
      shouldRestoreRtcCameraAfterResume(
        cameraEnabled: true,
        operationTargetEnabled: false,
        operationIsUserInitiated: false,
      ),
      isTrue,
    );
    expect(
      shouldRestoreRtcCameraAfterResume(
        cameraEnabled: false,
        operationTargetEnabled: true,
        operationIsUserInitiated: true,
      ),
      isTrue,
    );
  });

  test('native-ready pending join can only apply a camera disable', () {
    expect(
      canApplyRtcCameraState(
        enabled: false,
        rtcJoined: false,
        rtcNativeReady: true,
      ),
      isTrue,
    );
    expect(
      canApplyRtcCameraState(
        enabled: true,
        rtcJoined: false,
        rtcNativeReady: true,
      ),
      isFalse,
    );
    expect(
      canApplyRtcCameraState(
        enabled: false,
        rtcJoined: false,
        rtcNativeReady: false,
      ),
      isFalse,
    );
  });

  testWidgets('video controls wrap safely on a narrow Russian screen',
      (tester) async {
    tester.view.physicalSize = const Size(280, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ru', 'RU'),
        supportedLocales: AppLocalization.supportedLocales,
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(
          backgroundColor: const Color(0xFF0B4338),
          body: Align(
            alignment: Alignment.topCenter,
            child: SizedBox(
              width: 240,
              child: FriendCallControlBar(
                isVideo: true,
                isActive: true,
                muted: false,
                cameraEnabled: true,
                cameraOperationInFlight: false,
                speakerEnabled: true,
                ending: false,
                switchingCamera: false,
                onToggleMute: () {},
                onToggleCamera: () {},
                onHangUp: () {},
                onSwitchCamera: () {},
                onToggleSpeaker: () {},
              ),
            ),
          ),
        ),
      ),
    );

    const controlKeys = [
      ValueKey('call-control-mute'),
      ValueKey('call-control-camera'),
      ValueKey('call-control-hang-up'),
      ValueKey('call-control-switch-camera'),
      ValueKey('call-control-speaker'),
    ];
    for (final key in controlKeys) {
      expect(find.byKey(key), findsOneWidget);
    }
    final rowOffsets = controlKeys
        .map((key) => tester.getTopLeft(find.byKey(key)).dy.round())
        .toSet();
    expect(rowOffsets.length, greaterThan(1));
    expect(find.text('Выключить камеру'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('camera actions are disabled while a camera operation is active',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FriendCallControlBar(
            isVideo: true,
            isActive: true,
            muted: false,
            cameraEnabled: true,
            cameraOperationInFlight: true,
            speakerEnabled: true,
            ending: false,
            switchingCamera: false,
            onToggleMute: () {},
            onToggleCamera: () {},
            onHangUp: () {},
            onSwitchCamera: () {},
            onToggleSpeaker: () {},
          ),
        ),
      ),
    );

    IconButton button(String key) => tester.widget<IconButton>(
          find.descendant(
            of: find.byKey(ValueKey(key)),
            matching: find.byType(IconButton),
          ),
        );

    expect(button('call-control-camera').onPressed, isNull);
    expect(button('call-control-switch-camera').onPressed, isNull);
  });
}
