import 'dart:async';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:uuid/uuid.dart';

import '../errors.dart';
import 'audio_cue_service.dart';
import 'voice_activity_gate.dart';

final class RecordedAudioSegment {
  const RecordedAudioSegment({
    required this.path,
    required this.duration,
    required this.hasMeaningfulSpeech,
  });

  final String path;
  final Duration duration;
  final bool hasMeaningfulSpeech;
}

abstract interface class AudioSegmentRecorder {
  bool get isRecording;
  Future<void> start();
  Future<RecordedAudioSegment?> stop();
  Future<void> cancel();
  Future<void> deleteSegment(String path);
  Future<void> dispose();
}

final class AudioCapture implements AudioSegmentRecorder {
  AudioCapture({AudioRecorder? recorder})
      : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;
  String? _activePath;
  Stopwatch? _recordingClock;
  VoiceActivityGate? _voiceActivityGate;
  StreamSubscription<Amplitude>? _amplitudeSubscription;

  @override
  bool get isRecording => _activePath != null;

  @override
  Future<void> start() async {
    if (_activePath != null) return;
    final permission = await Permission.microphone.request();
    if (!permission.isGranted || !await _recorder.hasPermission()) {
      throw const AppException(
        '需要麦克风权限才能按住说话，请在系统设置中允许访问',
        code: 'MICROPHONE_DENIED',
      );
    }
    final temp = await getTemporaryDirectory();
    final path = p.join(temp.path, 'voice-${const Uuid().v4()}.m4a');
    // Keep the microphone closed until the ready cue has finished. This makes
    // the audible beep the exact boundary after which speech is recorded.
    await AudioCueService.playTalkReady();
    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        sampleRate: 16000,
        bitRate: 64000,
        numChannels: 1,
        autoGain: true,
        echoCancel: true,
        noiseSuppress: true,
      ),
      path: path,
    );
    _activePath = path;
    _recordingClock = Stopwatch()..start();
    _voiceActivityGate = VoiceActivityGate();
    _amplitudeSubscription =
        _recorder.onAmplitudeChanged(const Duration(milliseconds: 80)).listen(
              (amplitude) => _voiceActivityGate?.addSample(amplitude.current),
              // A platform without amplitude reporting must not break recording. Its
              // segment will fail closed as silence instead of reaching ASR as noise.
              onError: (_) {},
            );
  }

  @override
  Future<RecordedAudioSegment?> stop() async {
    if (_activePath == null) return null;
    final expectedPath = _activePath!;
    _activePath = null;
    try {
      final stoppedPath = await _recorder.stop() ?? expectedPath;
      final duration = _recordingClock?.elapsed ?? Duration.zero;
      final activity = _voiceActivityGate?.decision(duration) ??
          VoiceActivityDecision.unknown;
      final hasMeaningfulSpeech = activity != VoiceActivityDecision.silence;
      return RecordedAudioSegment(
        path: stoppedPath,
        duration: duration,
        hasMeaningfulSpeech: hasMeaningfulSpeech,
      );
    } catch (_) {
      await deleteSegment(expectedPath);
      rethrow;
    } finally {
      await _resetActivityTracking();
    }
  }

  @override
  Future<void> cancel() async {
    final path = _activePath;
    _activePath = null;
    try {
      await _recorder.cancel();
    } finally {
      await _resetActivityTracking();
      if (path != null) await deleteSegment(path);
    }
  }

  Future<void> _resetActivityTracking() async {
    _recordingClock?.stop();
    _recordingClock = null;
    _voiceActivityGate = null;
    await _amplitudeSubscription?.cancel();
    _amplitudeSubscription = null;
  }

  @override
  Future<void> deleteSegment(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  @override
  Future<void> dispose() async {
    await cancel();
    await _recorder.dispose();
  }
}
