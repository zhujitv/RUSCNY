import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/audio/voice_activity_gate.dart';

void main() {
  test('rejects a quick press even when it contains a loud transient', () {
    final gate = VoiceActivityGate();
    gate
      ..addSample(-20)
      ..addSample(-18)
      ..addSample(-17);

    expect(
      gate.hasMeaningfulSpeech(const Duration(milliseconds: 180)),
      isFalse,
    );
  });

  test('rejects silence and low background noise', () {
    final gate = VoiceActivityGate();
    for (final sample in [-80.0, -64.0, -52.0, -71.0, -49.0]) {
      gate.addSample(sample);
    }

    expect(gate.hasMeaningfulSpeech(const Duration(seconds: 2)), isFalse);
  });

  test('accepts sustained voice activity', () {
    final gate = VoiceActivityGate();
    gate
      ..addSample(-38)
      ..addSample(-33)
      ..addSample(-31);

    expect(
      gate.hasMeaningfulSpeech(const Duration(milliseconds: 480)),
      isTrue,
    );
  });

  test('treats unavailable amplitude data as unknown instead of silence', () {
    final gate = VoiceActivityGate();
    gate
      ..addSample(double.nan)
      ..addSample(double.infinity);

    expect(
      gate.decision(const Duration(seconds: 1)),
      VoiceActivityDecision.unknown,
    );
  });

  test('rejects separated handling transients without a voiced run', () {
    final gate = VoiceActivityGate();
    for (final sample in [-20.0, -70.0, -18.0, -68.0, -19.0]) {
      gate.addSample(sample);
    }

    expect(
      gate.decision(const Duration(seconds: 1)),
      VoiceActivityDecision.silence,
    );
  });
}
