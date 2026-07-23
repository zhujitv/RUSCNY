import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/audio/audio_capture.dart';
import 'package:tooyei_translator/core/models.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_controller.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_models.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_page.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_repository.dart';

void main() {
  testWidgets('renders two uniquely controlled languages and swaps orientation',
      (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = _controller();

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(home: FaceToFacePage(controller: controller)),
      ),
    );

    expect(find.text('面对面翻译'), findsOneWidget);
    expect(find.byKey(const ValueKey('face-talk-zh')), findsOneWidget);
    expect(find.byKey(const ValueKey('face-talk-ru')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('face-panel-ru-top')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const ValueKey('face-swap-sides')));
    await tester.pump();

    expect(
      find.byKey(const ValueKey('face-panel-zh-top')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('release callback survives the recording-state rebuild',
      (tester) async {
    final recorder = _PageRecorder();
    final controller = _controller(recorder: recorder);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(home: FaceToFacePage(controller: controller)),
      ),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(
        find.byKey(const ValueKey('face-talk-gesture-zh')),
      ),
    );
    await tester.pump(const Duration(milliseconds: 550));
    expect(controller.phase, FaceToFacePhase.recording);

    await gesture.up();
    await tester.pumpAndSettle();

    expect(recorder.stops, 1);
    expect(controller.turns, hasLength(1));
    expect(controller.phase, FaceToFacePhase.idle);
  });

  testWidgets('does not overflow on a narrow screen with large text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: child!,
          ),
          home: FaceToFacePage(controller: _controller()),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const ValueKey('face-talk-zh')), findsOneWidget);
    expect(find.byKey(const ValueKey('face-talk-ru')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

FaceToFaceController _controller({_PageRecorder? recorder}) =>
    FaceToFaceController(
      recorder: recorder ?? _PageRecorder(),
      translator: _PageTranslator(),
      playAudio: (_) async {},
      stopAudio: () async {},
    );

final class _PageRecorder implements AudioSegmentRecorder {
  bool _recording = false;
  int stops = 0;

  @override
  bool get isRecording => _recording;

  @override
  Future<void> start() async => _recording = true;

  @override
  Future<RecordedAudioSegment?> stop() async {
    stops += 1;
    _recording = false;
    return const RecordedAudioSegment(
      path: '/tmp/page.m4a',
      duration: Duration(seconds: 1),
      hasMeaningfulSpeech: true,
    );
  }

  @override
  Future<void> cancel() async => _recording = false;

  @override
  Future<void> deleteSegment(String path) async {}

  @override
  Future<void> dispose() async {}
}

final class _PageTranslator implements FaceToFaceTranslator {
  @override
  Future<FaceToFaceTranslation> translate({
    required String path,
    required Language sourceLanguage,
    required String idempotencyKey,
    CancelToken? cancelToken,
  }) async =>
      FaceToFaceTranslation(
        idempotencyKey: idempotencyKey,
        sourceLanguage: sourceLanguage,
        targetLanguage: sourceLanguage.opposite,
        sourceText: sourceLanguage == Language.zh ? '你好' : 'Привет',
        translatedText: sourceLanguage == Language.zh ? 'Здравствуйте' : '你好',
      );
}
