import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models.dart';

/// A stopped recording that must survive a room page/controller being
/// disposed. The same idempotency key is deliberately reused on every retry.
final class PendingAudioDraft {
  const PendingAudioDraft({
    required this.conversationId,
    required this.path,
    required this.sourceLanguage,
    required this.idempotencyKey,
  });

  final String conversationId;
  final String path;
  final Language sourceLanguage;
  final String idempotencyKey;
}

/// Tracks stopped recordings that still need either a successful FINAL
/// response or an explicit discard. It also provides a narrowly scoped cold
/// start cleanup for segments left behind by a process crash.
final class PendingAudioRegistry {
  final Set<String> _paths = {};
  final Map<String, PendingAudioDraft> _draftsByConversation = {};
  final Map<String, Future<void>> _deletions = {};

  void track(String path) => _paths.add(path);

  void retain(PendingAudioDraft draft) {
    final replaced = _draftsByConversation[draft.conversationId];
    if (replaced != null && replaced.path != draft.path) {
      throw StateError(
        'A conversation cannot retain more than one pending recording',
      );
    }
    _paths.add(draft.path);
    _draftsByConversation[draft.conversationId] = draft;
  }

  /// Returns a retained draft only while its local file still exists. Missing
  /// temp files are forgotten so the room does not present a retry that can
  /// never succeed.
  Future<PendingAudioDraft?> restore(String conversationId) async {
    final draft = _draftsByConversation[conversationId];
    if (draft == null) return null;
    if (await File(draft.path).exists()) return draft;
    _paths.remove(draft.path);
    _draftsByConversation.remove(conversationId);
    return null;
  }

  Future<void> delete(String path) {
    final active = _deletions[path];
    if (active != null) return active;
    final deletion = _delete(path);
    _deletions[path] = deletion;
    return deletion.whenComplete(() {
      if (identical(_deletions[path], deletion)) _deletions.remove(path);
    });
  }

  Future<void> _delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
    _paths.remove(path);
    _draftsByConversation.removeWhere((_, draft) => draft.path == path);
  }

  Future<void> clear() async {
    for (final path in _paths.toList(growable: false)) {
      try {
        await delete(path);
      } catch (_) {
        // Keep the path registered so a later lifecycle cleanup can retry.
      }
    }
    // Session teardown must never expose the old user's retry metadata to a
    // later account, even if the platform temporarily refuses file deletion.
    // Failed paths stay in `_paths` solely for a later cleanup attempt.
    _draftsByConversation.clear();
  }

  /// Runs before the widget tree starts, so no current recording can be
  /// mistaken for crash residue. The exact UUID filename pattern ensures this
  /// app never sweeps unrelated files from the platform temporary directory.
  static Future<void> cleanupCrashResidue({Directory? directory}) async {
    final target = directory ?? await getTemporaryDirectory();
    if (!await target.exists()) return;
    final pattern = RegExp(
      r'^voice-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
      r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.m4a$',
    );
    await for (final entity in target.list(followLinks: false)) {
      if (entity is! File || !pattern.hasMatch(p.basename(entity.path))) {
        continue;
      }
      try {
        await entity.delete();
      } catch (_) {
        // Best effort: a later launch or normal lifecycle cleanup retries.
      }
    }
  }
}
