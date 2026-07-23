/// Lightweight voice-activity gate used before an audio segment is uploaded.
///
/// This intentionally works from recorder amplitude samples instead of ASR
/// text. Rejecting a transcript such as "嗯" would also reject a real utterance.
enum VoiceActivityDecision { speech, silence, unknown }

final class VoiceActivityGate {
  VoiceActivityGate({
    this.speechThresholdDbfs = -45,
    this.minimumRecordingDuration = const Duration(milliseconds: 400),
    this.minimumAnalysisSamples = 3,
    this.minimumConsecutiveVoicedSamples = 3,
  });

  final double speechThresholdDbfs;
  final Duration minimumRecordingDuration;
  final int minimumAnalysisSamples;
  final int minimumConsecutiveVoicedSamples;

  int _validSamples = 0;
  int _consecutiveVoicedSamples = 0;
  int _longestVoicedRun = 0;

  void addSample(double currentDbfs) {
    if (!currentDbfs.isFinite) return;
    _validSamples += 1;
    if (currentDbfs >= speechThresholdDbfs) {
      _consecutiveVoicedSamples += 1;
      if (_consecutiveVoicedSamples > _longestVoicedRun) {
        _longestVoicedRun = _consecutiveVoicedSamples;
      }
    } else {
      _consecutiveVoicedSamples = 0;
    }
  }

  VoiceActivityDecision decision(Duration recordingDuration) {
    if (recordingDuration < minimumRecordingDuration) {
      return VoiceActivityDecision.silence;
    }
    // Some Android recorders do not expose amplitude data, or expose it only
    // after a delay. That is an unknown signal, not proof of silence: allow the
    // provider to decide rather than dropping a real utterance locally.
    if (_validSamples < minimumAnalysisSamples) {
      return VoiceActivityDecision.unknown;
    }
    return _longestVoicedRun >= minimumConsecutiveVoicedSamples
        ? VoiceActivityDecision.speech
        : VoiceActivityDecision.silence;
  }

  bool hasMeaningfulSpeech(Duration recordingDuration) =>
      decision(recordingDuration) == VoiceActivityDecision.speech;
}
