import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:mocktail/mocktail.dart';
import 'package:tooyei_translator/core/audio/audio_playback_queue.dart';

final class _MockAudioPlayer extends Mock implements AudioPlayer {}

void main() {
  test('stop during token lookup prevents stale URL and playback', () async {
    final player = _MockAudioPlayer();
    final token = Completer<String?>();
    when(() => player.stop()).thenAnswer((_) async {});
    when(() => player.setSpeed(any())).thenAnswer((_) async {});
    when(
      () => player.setUrl(any(), headers: any(named: 'headers')),
    ).thenAnswer((_) async => null);
    when(() => player.play()).thenAnswer((_) async {});
    final queue = AudioPlaybackQueue(
      player: player,
      accessToken: () => token.future,
    );

    final playing = queue.playNow('https://api.example.test/audio/one');
    await Future<void>.delayed(Duration.zero);
    await queue.stop();
    token.complete('new-token');
    await playing;

    verifyNever(
      () => player.setUrl(any(), headers: any(named: 'headers')),
    );
    verifyNever(() => player.play());
  });

  test('stop while setUrl resolves cancels the stale prepared item', () async {
    final player = _MockAudioPlayer();
    final settingUrl = Completer<Duration?>();
    final setUrlStarted = Completer<void>();
    when(() => player.stop()).thenAnswer((_) async {});
    when(() => player.setSpeed(any())).thenAnswer((_) async {});
    when(
      () => player.setUrl(any(), headers: any(named: 'headers')),
    ).thenAnswer((_) {
      if (!setUrlStarted.isCompleted) setUrlStarted.complete();
      return settingUrl.future;
    });
    when(() => player.play()).thenAnswer((_) async {});
    final queue = AudioPlaybackQueue(player: player);

    final playing = queue.playNow('https://api.example.test/audio/two');
    await setUrlStarted.future;
    await queue.stop();
    settingUrl.complete(null);
    await playing;

    verifyNever(() => player.play());
    // playNow's initial stop, the explicit stop, and the post-setUrl stale
    // guard all stop the player.
    verify(() => player.stop()).called(3);
  });

  test('public provider audio never receives the app bearer token', () async {
    final player = _MockAudioPlayer();
    var tokenReads = 0;
    when(() => player.stop()).thenAnswer((_) async {});
    when(() => player.setSpeed(any())).thenAnswer((_) async {});
    when(
      () => player.setUrl(any(), headers: any(named: 'headers')),
    ).thenAnswer((_) async => null);
    when(() => player.play()).thenAnswer((_) async {});
    final queue = AudioPlaybackQueue(
      player: player,
      accessToken: () async {
        tokenReads += 1;
        return 'private-app-token';
      },
    );

    await queue.playPublicNow('https://provider.example/temporary.mp3');

    expect(tokenReads, 0);
    verify(
      () => player.setUrl(
        'https://provider.example/temporary.mp3',
        headers: null,
      ),
    ).called(1);
    verify(() => player.play()).called(1);
  });
}
