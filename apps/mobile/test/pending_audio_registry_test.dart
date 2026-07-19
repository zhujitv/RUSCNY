import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/audio/pending_audio_registry.dart';
import 'package:tooyei_translator/core/models.dart';

void main() {
  test('cold-start cleanup deletes only managed voice UUID segments', () async {
    final directory =
        await Directory.systemTemp.createTemp('translator-audio-');
    final managed = File(
      '${directory.path}/voice-123e4567-e89b-12d3-a456-426614174000.m4a',
    );
    final unrelated = File('${directory.path}/voice-customer-upload.m4a');
    await managed.writeAsBytes([1, 2, 3]);
    await unrelated.writeAsBytes([4, 5, 6]);

    try {
      await PendingAudioRegistry.cleanupCrashResidue(directory: directory);

      expect(await managed.exists(), isFalse);
      expect(await unrelated.exists(), isTrue);
    } finally {
      await directory.delete(recursive: true);
    }
  });

  test('concurrent lifecycle cleanup of one pending path is idempotent',
      () async {
    final directory =
        await Directory.systemTemp.createTemp('translator-audio-');
    final segment = File('${directory.path}/pending.m4a');
    await segment.writeAsBytes([1]);
    final registry = PendingAudioRegistry()..track(segment.path);

    try {
      await Future.wait([
        registry.delete(segment.path),
        registry.delete(segment.path),
      ]);
      expect(await segment.exists(), isFalse);
    } finally {
      if (await directory.exists()) await directory.delete(recursive: true);
    }
  });

  test('retained draft survives room controller replacement until deleted',
      () async {
    final directory =
        await Directory.systemTemp.createTemp('translator-audio-');
    final segment = File('${directory.path}/pending.m4a');
    await segment.writeAsBytes([1, 2, 3]);
    final registry = PendingAudioRegistry();
    const draft = PendingAudioDraft(
      conversationId: 'conversation-1',
      path: '',
      sourceLanguage: Language.ru,
      idempotencyKey: 'same-key-on-every-retry',
    );
    registry.retain(
      PendingAudioDraft(
        conversationId: draft.conversationId,
        path: segment.path,
        sourceLanguage: draft.sourceLanguage,
        idempotencyKey: draft.idempotencyKey,
      ),
    );

    try {
      final restored = await registry.restore('conversation-1');
      expect(restored?.path, segment.path);
      expect(restored?.sourceLanguage, Language.ru);
      expect(restored?.idempotencyKey, 'same-key-on-every-retry');

      await registry.delete(segment.path);
      expect(await registry.restore('conversation-1'), isNull);
      expect(await segment.exists(), isFalse);
    } finally {
      if (await directory.exists()) await directory.delete(recursive: true);
    }
  });

  test('restore forgets a draft whose temp file no longer exists', () async {
    final registry = PendingAudioRegistry()
      ..retain(
        const PendingAudioDraft(
          conversationId: 'conversation-1',
          path: '/definitely/missing/voice.m4a',
          sourceLanguage: Language.zh,
          idempotencyKey: 'key',
        ),
      );

    expect(await registry.restore('conversation-1'), isNull);
  });
}
