import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/audio/audio_capture.dart';
import 'package:tooyei_translator/core/models.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_controller.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_models.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_repository.dart';

void main() {
  test('silence is deleted locally and never reaches translation', () async {
    final recorder = _FakeRecorder(
      result: const RecordedAudioSegment(
        path: '/tmp/silent.m4a',
        duration: Duration(seconds: 1),
        hasMeaningfulSpeech: false,
      ),
    );
    final translator = _FakeTranslator();
    final controller = _controller(recorder, translator);

    await controller.beginRecording(Language.zh);
    await controller.finishRecording();

    expect(translator.calls, 0);
    expect(recorder.deleted, ['/tmp/silent.m4a']);
    expect(controller.notice, '未检测到说话，未发送');
    expect(controller.phase, FaceToFacePhase.idle);
    await controller.close();
  });

  test('Chinese speech translates to Russian and locks both mics during TTS',
      () async {
    final recorder = _FakeRecorder(result: _spoken('/tmp/zh.m4a'));
    final translator = _FakeTranslator(
      response: _translation(
        sourceLanguage: Language.zh,
        sourceText: '你好',
        translatedText: 'Здравствуйте',
        audioUrl: 'https://audio.test/ru.mp3',
      ),
    );
    final playback = Completer<void>();
    final played = <String>[];
    final controller = FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (url) {
        played.add(url);
        return playback.future;
      },
      stopAudio: () async {},
    );

    await controller.beginRecording(Language.zh);
    final finishing = controller.finishRecording();
    await _flush();

    expect(translator.sourceLanguages, [Language.zh]);
    expect(controller.phase, FaceToFacePhase.playing);
    expect(controller.canRecord, isFalse);
    expect(played, ['https://audio.test/ru.mp3']);
    expect(controller.turns.single.textFor(Language.ru), 'Здравствуйте');

    playback.complete();
    await finishing;
    expect(controller.phase, FaceToFacePhase.idle);
    expect(controller.canRecord, isTrue);
    await controller.close();
  });

  test('quick release while recorder starts is remembered and sent once',
      () async {
    final start = Completer<void>();
    final recorder = _FakeRecorder(
      result: _spoken('/tmp/quick.m4a'),
      startGate: start,
    );
    final translator = _FakeTranslator(
      response: _translation(
        sourceLanguage: Language.ru,
        sourceText: 'Привет',
        translatedText: '你好',
      ),
    );
    final controller = _controller(recorder, translator);

    final beginning = controller.beginRecording(Language.ru);
    await _flush();
    await controller.finishRecording();
    expect(translator.calls, 0);

    start.complete();
    await beginning;
    expect(translator.calls, 1);
    expect(translator.sourceLanguages, [Language.ru]);
    expect(recorder.stops, 1);
    await controller.close();
  });

  test('a second language cannot start while one utterance is active',
      () async {
    final start = Completer<void>();
    final recorder = _FakeRecorder(
      result: _spoken('/tmp/one.m4a'),
      startGate: start,
    );
    final translator = _FakeTranslator();
    final controller = _controller(recorder, translator);

    final first = controller.beginRecording(Language.zh);
    await _flush();
    await controller.beginRecording(Language.ru);

    expect(recorder.starts, 1);
    expect(controller.activeLanguage, Language.zh);
    start.complete();
    await first;
    await controller.cancelRecording();
    await controller.close();
  });

  test('text remains available when TTS is unavailable', () async {
    final recorder = _FakeRecorder(result: _spoken('/tmp/text.m4a'));
    final translator = _FakeTranslator(
      response: _translation(
        sourceLanguage: Language.ru,
        sourceText: 'Где метро?',
        translatedText: '地铁在哪里？',
      ),
    );
    final controller = _controller(recorder, translator);

    await controller.beginRecording(Language.ru);
    await controller.finishRecording();

    expect(controller.turns.single.textFor(Language.zh), '地铁在哪里？');
    expect(controller.notice, '文字已翻译，语音暂不可用，可重试语音');
    expect(controller.phase, FaceToFacePhase.idle);
    expect(controller.hasPendingRetry, isTrue);
    await controller.close();
  });

  test('TTS retry updates one text turn without rerunning a new recording',
      () async {
    final recorder = _FakeRecorder(result: _spoken('/tmp/tts-retry.m4a'));
    final translator = _TtsRetryTranslator();
    final played = <String>[];
    final controller = FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (url) async => played.add(url),
      stopAudio: () async {},
    );

    await controller.beginRecording(Language.zh);
    await controller.finishRecording();
    expect(controller.turns, hasLength(1));
    expect(controller.hasPendingRetry, isTrue);
    expect(recorder.deleted, isEmpty);

    await controller.retryPending();

    expect(controller.turns, hasLength(1));
    expect(controller.hasPendingRetry, isFalse);
    expect(translator.keys[1], translator.keys[0]);
    expect(recorder.deleted, ['/tmp/tts-retry.m4a']);
    expect(played, ['https://audio.test/retried.mp3']);
    await controller.close();
  });

  test('discarding a failed TTS keeps the translated text turn', () async {
    final recorder = _FakeRecorder(result: _spoken('/tmp/discard.m4a'));
    final translator = _FakeTranslator(
      response: _translation(
        sourceLanguage: Language.zh,
        sourceText: '你好',
        translatedText: 'Здравствуйте',
      ),
    );
    final controller = _controller(recorder, translator);

    await controller.beginRecording(Language.zh);
    await controller.finishRecording();
    await controller.discardPending();

    expect(controller.turns, hasLength(1));
    expect(controller.hasPendingRetry, isFalse);
    expect(controller.notice, '已保留文字，已放弃语音重试');
    expect(recorder.deleted, ['/tmp/discard.m4a']);
    await controller.close();
  });

  test('failed translation keeps the same audio and idempotency key for retry',
      () async {
    final recorder = _FakeRecorder(result: _spoken('/tmp/retry.m4a'));
    final translator = _RetryTranslator();
    final controller = FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (_) async {},
      stopAudio: () async {},
    );

    await controller.beginRecording(Language.zh);
    await controller.finishRecording();

    expect(controller.hasPendingRetry, isTrue);
    expect(controller.canRecord, isFalse);
    expect(recorder.deleted, isEmpty);

    await controller.retryPending();

    expect(translator.keys, hasLength(2));
    expect(translator.keys[1], translator.keys[0]);
    expect(translator.paths, ['/tmp/retry.m4a', '/tmp/retry.m4a']);
    expect(recorder.deleted, ['/tmp/retry.m4a']);
    expect(controller.turns, hasLength(1));
    expect(controller.hasPendingRetry, isFalse);
    await controller.close();
  });

  test('close cancels a late request and prevents playback or retained text',
      () async {
    final recorder = _FakeRecorder(result: _spoken('/tmp/late.m4a'));
    final response = Completer<FaceToFaceTranslation>();
    final translator = _FakeTranslator(responseGate: response);
    var playbackCalls = 0;
    final controller = FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (_) async => playbackCalls += 1,
      stopAudio: () async {},
    );

    await controller.beginRecording(Language.zh);
    final finishing = controller.finishRecording();
    await _flush();
    expect(controller.phase, FaceToFacePhase.translating);

    await controller.close();
    response.complete(
      _translation(
        sourceLanguage: Language.zh,
        sourceText: '迟到',
        translatedText: 'Поздно',
        audioUrl: 'https://audio.test/late.mp3',
      ),
    );
    await finishing;

    expect(playbackCalls, 0);
    expect(controller.turns, isEmpty);
    expect(recorder.deleted, contains('/tmp/late.m4a'));
    expect(recorder.disposals, 1);
  });

  test('close waits for an in-flight recorder start before disposal', () async {
    final start = Completer<void>();
    final recorder = _FakeRecorder(
      result: _spoken('/tmp/start-race.m4a'),
      startGate: start,
    );
    final controller = _controller(recorder, _FakeTranslator());

    final beginning = controller.beginRecording(Language.zh);
    await _flush();
    final closing = controller.close();
    var closed = false;
    unawaited(closing.then((_) => closed = true));
    await _flush();
    expect(closed, isFalse);

    start.complete();
    await beginning;
    await closing;

    expect(recorder.isRecording, isFalse);
    expect(recorder.disposals, 1);
  });

  test('backgrounding during recorder stop prevents upload and playback',
      () async {
    final stop = Completer<void>();
    final recorder = _FakeRecorder(
      result: _spoken('/tmp/stop-race.m4a'),
      stopGate: stop,
    );
    final translator = _FakeTranslator();
    var playbackCalls = 0;
    final controller = FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (_) async => playbackCalls += 1,
      stopAudio: () async {},
    );

    await controller.beginRecording(Language.zh);
    final finishing = controller.finishRecording();
    await _flush();
    final suspending = controller.suspend();
    await _flush();
    stop.complete();
    await Future.wait([finishing, suspending]);

    expect(translator.calls, 0);
    expect(playbackCalls, 0);
    expect(recorder.deleted, ['/tmp/stop-race.m4a']);
    expect(controller.phase, FaceToFacePhase.idle);
    await controller.close();
  });

  test('backgrounding during translation cancels late automatic playback',
      () async {
    final response = Completer<FaceToFaceTranslation>();
    final recorder = _FakeRecorder(result: _spoken('/tmp/background.m4a'));
    final translator = _FakeTranslator(responseGate: response);
    var playbackCalls = 0;
    final controller = FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (_) async => playbackCalls += 1,
      stopAudio: () async {},
    );

    await controller.beginRecording(Language.zh);
    final finishing = controller.finishRecording();
    await _flush();
    await controller.suspend();
    expect(controller.phase, FaceToFacePhase.idle);
    expect(controller.hasPendingRetry, isTrue);

    response.complete(
      _translation(
        sourceLanguage: Language.zh,
        sourceText: '迟到',
        translatedText: 'Поздно',
        audioUrl: 'https://audio.test/late.mp3',
      ),
    );
    await finishing;

    expect(playbackCalls, 0);
    expect(controller.turns, isEmpty);
    expect(controller.notice, '操作已暂停，可重试本句');
    await controller.close();
  });
}

FaceToFaceController _controller(
  _FakeRecorder recorder,
  _FakeTranslator translator,
) =>
    FaceToFaceController(
      recorder: recorder,
      translator: translator,
      playAudio: (_) async {},
      stopAudio: () async {},
    );

RecordedAudioSegment _spoken(String path) => RecordedAudioSegment(
      path: path,
      duration: const Duration(seconds: 1),
      hasMeaningfulSpeech: true,
    );

FaceToFaceTranslation _translation({
  required Language sourceLanguage,
  required String sourceText,
  required String translatedText,
  String? audioUrl,
}) =>
    FaceToFaceTranslation(
      idempotencyKey: 'server-key',
      sourceLanguage: sourceLanguage,
      targetLanguage: sourceLanguage.opposite,
      sourceText: sourceText,
      translatedText: translatedText,
      audioUrl: audioUrl,
    );

Future<void> _flush() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

final class _FakeRecorder implements AudioSegmentRecorder {
  _FakeRecorder({required this.result, this.startGate, this.stopGate});

  final RecordedAudioSegment result;
  final Completer<void>? startGate;
  final Completer<void>? stopGate;
  final List<String> deleted = [];
  int starts = 0;
  int stops = 0;
  int cancellations = 0;
  int disposals = 0;
  bool _recording = false;

  @override
  bool get isRecording => _recording;

  @override
  Future<void> start() async {
    starts += 1;
    await startGate?.future;
    _recording = true;
  }

  @override
  Future<RecordedAudioSegment?> stop() async {
    stops += 1;
    await stopGate?.future;
    _recording = false;
    return result;
  }

  @override
  Future<void> cancel() async {
    cancellations += 1;
    _recording = false;
  }

  @override
  Future<void> deleteSegment(String path) async => deleted.add(path);

  @override
  Future<void> dispose() async => disposals += 1;
}

final class _FakeTranslator implements FaceToFaceTranslator {
  _FakeTranslator({this.response, this.responseGate});

  final FaceToFaceTranslation? response;
  final Completer<FaceToFaceTranslation>? responseGate;
  final List<Language> sourceLanguages = [];
  int calls = 0;

  @override
  Future<FaceToFaceTranslation> translate({
    required String path,
    required Language sourceLanguage,
    required String idempotencyKey,
    CancelToken? cancelToken,
  }) async {
    calls += 1;
    sourceLanguages.add(sourceLanguage);
    if (responseGate != null) return responseGate!.future;
    return response ??
        _translation(
          sourceLanguage: sourceLanguage,
          sourceText: 'source',
          translatedText: 'target',
        );
  }
}

final class _RetryTranslator implements FaceToFaceTranslator {
  final List<String> keys = [];
  final List<String> paths = [];

  @override
  Future<FaceToFaceTranslation> translate({
    required String path,
    required Language sourceLanguage,
    required String idempotencyKey,
    CancelToken? cancelToken,
  }) async {
    paths.add(path);
    keys.add(idempotencyKey);
    if (keys.length == 1) throw Exception('temporary failure');
    return FaceToFaceTranslation(
      idempotencyKey: idempotencyKey,
      sourceLanguage: sourceLanguage,
      targetLanguage: sourceLanguage.opposite,
      sourceText: '你好',
      translatedText: 'Здравствуйте',
      audioUrl: 'https://audio.test/retry.mp3',
    );
  }
}

final class _TtsRetryTranslator implements FaceToFaceTranslator {
  final List<String> keys = [];

  @override
  Future<FaceToFaceTranslation> translate({
    required String path,
    required Language sourceLanguage,
    required String idempotencyKey,
    CancelToken? cancelToken,
  }) async {
    keys.add(idempotencyKey);
    return FaceToFaceTranslation(
      idempotencyKey: idempotencyKey,
      sourceLanguage: sourceLanguage,
      targetLanguage: sourceLanguage.opposite,
      sourceText: '你好',
      translatedText: 'Здравствуйте',
      audioUrl: keys.length == 1 ? null : 'https://audio.test/retried.mp3',
    );
  }
}
