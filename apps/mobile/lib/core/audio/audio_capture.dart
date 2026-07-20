import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:uuid/uuid.dart';

import '../errors.dart';
import 'audio_cue_service.dart';

final class AudioCapture {
  AudioCapture({AudioRecorder? recorder})
      : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;
  String? _activePath;

  bool get isRecording => _activePath != null;

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
  }

  Future<String?> stop() async {
    if (_activePath == null) return null;
    final expectedPath = _activePath!;
    _activePath = null;
    try {
      return await _recorder.stop() ?? expectedPath;
    } catch (_) {
      await deleteSegment(expectedPath);
      rethrow;
    }
  }

  Future<void> cancel() async {
    final path = _activePath;
    _activePath = null;
    await _recorder.cancel();
    if (path != null) await deleteSegment(path);
  }

  Future<void> deleteSegment(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  Future<void> dispose() async {
    await cancel();
    await _recorder.dispose();
  }
}
