import 'dart:async';
import 'dart:collection';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../../core/audio/audio_capture.dart';
import '../../core/errors.dart';
import '../../core/models.dart';
import 'face_to_face_models.dart';
import 'face_to_face_repository.dart';

enum FaceToFacePhase { idle, recording, translating, playing }

enum _RecordingRelease { send, cancel }

final class _PendingFaceToFaceTurn {
  const _PendingFaceToFaceTurn({
    required this.path,
    required this.sourceLanguage,
    required this.idempotencyKey,
    this.completedTurnIndex,
  });

  final String path;
  final Language sourceLanguage;
  final String idempotencyKey;
  final int? completedTurnIndex;

  _PendingFaceToFaceTurn withCompletedTurnIndex(int index) =>
      _PendingFaceToFaceTurn(
        path: path,
        sourceLanguage: sourceLanguage,
        idempotencyKey: idempotencyKey,
        completedTurnIndex: index,
      );
}

final class FaceToFaceController extends ChangeNotifier {
  FaceToFaceController({
    required AudioSegmentRecorder recorder,
    required FaceToFaceTranslator translator,
    required Future<void> Function(String url) playAudio,
    required Future<void> Function() stopAudio,
  })  : _recorder = recorder,
        _translator = translator,
        _playAudio = playAudio,
        _stopAudio = stopAudio;

  final AudioSegmentRecorder _recorder;
  final FaceToFaceTranslator _translator;
  final Future<void> Function(String url) _playAudio;
  final Future<void> Function() _stopAudio;
  final List<FaceToFaceTurn> _turns = [];

  FaceToFacePhase _phase = FaceToFacePhase.idle;
  Language? _activeLanguage;
  String? _notice;
  bool _recordingStartInFlight = false;
  Completer<void>? _recordingStartSettled;
  Completer<void>? _recordingStopSettled;
  _RecordingRelease? _pendingRelease;
  _PendingFaceToFaceTurn? _pendingTurn;
  CancelToken? _requestCancellation;
  String? _pendingPath;
  int _generation = 0;
  bool _closed = false;

  FaceToFacePhase get phase => _phase;
  Language? get activeLanguage => _activeLanguage;
  String? get notice => _notice;
  UnmodifiableListView<FaceToFaceTurn> get turns =>
      UnmodifiableListView(_turns);
  bool get hasPendingRetry => _pendingTurn != null;
  bool get canRecord =>
      !_closed && _phase == FaceToFacePhase.idle && _pendingTurn == null;

  Future<void> beginRecording(Language language) async {
    if (!canRecord) return;
    final operation = _generation;
    final startSettled = Completer<void>();
    _recordingStartSettled = startSettled;
    _recordingStartInFlight = true;
    _pendingRelease = null;
    _phase = FaceToFacePhase.recording;
    _activeLanguage = language;
    _notice = null;
    notifyListeners();
    try {
      await _stopAudio();
      if (_closed || operation != _generation) return;
      await _recorder.start();
      _recordingStartInFlight = false;
      if (_closed || operation != _generation) {
        await _recorder.cancel();
        return;
      }
      final release = _pendingRelease;
      _pendingRelease = null;
      if (release == _RecordingRelease.send) {
        await _finishStartedRecording(language, operation);
      } else if (release == _RecordingRelease.cancel) {
        await _cancelStartedRecording();
      }
    } catch (error) {
      try {
        await _recorder.cancel();
      } catch (_) {}
      if (!_closed && operation == _generation) {
        _setIdle('录音失败：${readableError(error)}');
      }
    } finally {
      _recordingStartInFlight = false;
      _pendingRelease = null;
      if (identical(_recordingStartSettled, startSettled)) {
        _recordingStartSettled = null;
      }
      if (!startSettled.isCompleted) startSettled.complete();
    }
  }

  Future<void> finishRecording() async {
    if (_phase != FaceToFacePhase.recording || _activeLanguage == null) return;
    if (_recordingStartInFlight) {
      _pendingRelease ??= _RecordingRelease.send;
      return;
    }
    await _finishStartedRecording(_activeLanguage!, _generation);
  }

  Future<void> cancelRecording() async {
    if (_phase != FaceToFacePhase.recording) return;
    if (_recordingStartInFlight) {
      _pendingRelease = _RecordingRelease.cancel;
      return;
    }
    await _cancelStartedRecording();
  }

  Future<void> _cancelStartedRecording() async {
    try {
      await _recorder.cancel();
    } finally {
      if (!_closed) _setIdle(null);
    }
  }

  Future<void> _finishStartedRecording(
    Language sourceLanguage,
    int operation,
  ) async {
    RecordedAudioSegment? segment;
    final stopSettled = Completer<void>();
    _recordingStopSettled = stopSettled;
    try {
      segment = await _recorder.stop();
    } catch (error) {
      if (!_closed && operation == _generation) {
        _setIdle('录音失败：${readableError(error)}');
      }
      return;
    } finally {
      if (identical(_recordingStopSettled, stopSettled)) {
        _recordingStopSettled = null;
      }
      if (!stopSettled.isCompleted) stopSettled.complete();
    }
    if (segment == null) {
      if (!_closed && operation == _generation) _setIdle('录音失败，请重试');
      return;
    }
    _pendingPath = segment.path;
    if (_closed || operation != _generation) {
      await _deletePendingPath();
      return;
    }
    if (!segment.hasMeaningfulSpeech) {
      await _deletePendingPath();
      if (!_closed && operation == _generation) {
        _setIdle('未检测到说话，未发送');
      }
      return;
    }

    final idempotencyKey = const Uuid().v4();
    _pendingTurn = _PendingFaceToFaceTurn(
      path: segment.path,
      sourceLanguage: sourceLanguage,
      idempotencyKey: idempotencyKey,
    );
    await _translatePending(operation);
  }

  Future<void> retryPending() async {
    if (_closed || _pendingTurn == null || _phase != FaceToFacePhase.idle) {
      return;
    }
    await _translatePending(_generation);
  }

  Future<void> _translatePending(int operation) async {
    final pending = _pendingTurn;
    if (pending == null) return;
    _phase = FaceToFacePhase.translating;
    _activeLanguage = pending.sourceLanguage;
    _notice = null;
    notifyListeners();
    final cancellation = CancelToken();
    _requestCancellation = cancellation;
    late final FaceToFaceTranslation translation;
    try {
      translation = await _translator.translate(
        path: pending.path,
        sourceLanguage: pending.sourceLanguage,
        idempotencyKey: pending.idempotencyKey,
        cancelToken: cancellation,
      );
    } catch (error) {
      final cancelled = error is DioException && CancelToken.isCancel(error);
      if (!_closed && operation == _generation && !cancelled) {
        _setIdle('翻译失败：${readableError(error)}。可重试本句');
      }
      return;
    } finally {
      if (identical(_requestCancellation, cancellation)) {
        _requestCancellation = null;
      }
    }
    if (_closed || operation != _generation) return;

    final completedTurn = FaceToFaceTurn(
      translation: translation,
      createdAt: DateTime.now(),
    );
    int completedTurnIndex;
    final previousIndex = pending.completedTurnIndex;
    if (previousIndex != null && previousIndex < _turns.length) {
      _turns[previousIndex] = completedTurn;
      completedTurnIndex = previousIndex;
    } else {
      _turns.add(completedTurn);
      if (_turns.length > 30) _turns.removeAt(0);
      completedTurnIndex = _turns.length - 1;
    }
    final audioUrl = translation.audioUrl;
    if (audioUrl?.isNotEmpty != true) {
      _pendingTurn = pending.withCompletedTurnIndex(completedTurnIndex);
      _setIdle('文字已翻译，语音暂不可用，可重试语音');
      return;
    }
    _pendingTurn = null;
    await _deletePendingPath();
    await _playTranslation(audioUrl!, operation, automatic: true);
  }

  Future<void> replay(FaceToFaceTurn turn) async {
    final url = turn.translation.audioUrl;
    if (!canRecord || url?.isNotEmpty != true) return;
    await _playTranslation(url!, _generation, automatic: false);
  }

  Future<void> _playTranslation(
    String url,
    int operation, {
    required bool automatic,
  }) async {
    _phase = FaceToFacePhase.playing;
    _activeLanguage = null;
    _notice = null;
    notifyListeners();
    try {
      await _playAudio(url);
      // Keep the microphone locked through the speaker tail so translated
      // speech cannot immediately be captured as the next utterance.
      await Future<void>.delayed(const Duration(milliseconds: 250));
      if (!_closed && operation == _generation) _setIdle(null);
    } catch (error) {
      if (!_closed && operation == _generation) {
        _setIdle(
          automatic ? '文字已翻译，语音播放失败' : '语音播放失败：${readableError(error)}',
        );
      }
    }
  }

  Future<void> stopPlayback() async {
    if (_phase != FaceToFacePhase.playing) return;
    _generation += 1;
    await _stopAudio();
    if (!_closed) _setIdle(null);
  }

  Future<void> clear() async {
    if (_closed) return;
    _generation += 1;
    _requestCancellation?.cancel('face-to-face conversation cleared');
    _requestCancellation = null;
    _pendingRelease = _RecordingRelease.cancel;
    try {
      await _stopAudio();
    } catch (_) {}
    await _recordingStartSettled?.future;
    await _recordingStopSettled?.future;
    try {
      if (_recorder.isRecording || _phase == FaceToFacePhase.recording) {
        await _recorder.cancel();
      }
    } catch (_) {}
    await _deletePendingPath();
    _pendingTurn = null;
    _turns.clear();
    _setIdle(null);
  }

  Future<void> discardPending() async {
    if (_closed || _phase != FaceToFacePhase.idle) return;
    final pending = _pendingTurn;
    if (pending == null) return;
    _generation += 1;
    _pendingTurn = null;
    await _deletePendingPath();
    _setIdle(
      pending.completedTurnIndex == null ? '已放弃本句' : '已保留文字，已放弃语音重试',
    );
  }

  Future<void> suspend() async {
    if (_closed) return;
    if (_phase == FaceToFacePhase.idle) return;
    final hadPendingTurn = _pendingTurn != null;
    _generation += 1;
    _requestCancellation?.cancel('face-to-face app backgrounded');
    _requestCancellation = null;
    _pendingRelease = _RecordingRelease.cancel;
    try {
      await _stopAudio();
    } catch (_) {}
    await _recordingStartSettled?.future;
    await _recordingStopSettled?.future;
    try {
      if (_recorder.isRecording) await _recorder.cancel();
    } catch (_) {}
    if (!_closed) {
      _setIdle(
        hadPendingTurn && _pendingTurn != null ? '操作已暂停，可重试本句' : null,
      );
    }
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _generation += 1;
    _requestCancellation?.cancel('face-to-face page closed');
    _requestCancellation = null;
    _pendingRelease = _RecordingRelease.cancel;
    try {
      await _stopAudio();
    } catch (_) {}
    await _recordingStartSettled?.future;
    await _recordingStopSettled?.future;
    try {
      await _recorder.cancel();
    } catch (_) {}
    await _deletePendingPath();
    _pendingTurn = null;
    _turns.clear();
    await _recorder.dispose();
  }

  Future<void> _deletePendingPath() async {
    final path = _pendingPath;
    _pendingPath = null;
    if (path == null) return;
    try {
      await _recorder.deleteSegment(path);
    } catch (_) {}
  }

  void _setIdle(String? notice) {
    _phase = FaceToFacePhase.idle;
    _activeLanguage = null;
    _notice = notice;
    if (!_closed) notifyListeners();
  }
}
