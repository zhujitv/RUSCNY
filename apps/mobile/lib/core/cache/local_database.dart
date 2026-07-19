import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models.dart';

final class LocalDatabase {
  Database? _database;

  Future<Database> get _db async => _database ??= await _open();

  Future<Database> _open() async {
    final path = p.join(await getDatabasesPath(), 'tooyei_translator.db');
    return openDatabase(
      path,
      version: 1,
      onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE conversations_cache (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');
        await db.execute('''
          CREATE TABLE messages_cache (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(conversation_id, sequence)
          )
        ''');
        await db.execute('''
          CREATE INDEX messages_conversation_sequence
          ON messages_cache(conversation_id, sequence)
        ''');
        await db.execute('''
          CREATE TABLE preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        ''');
      },
    );
  }

  Future<void> cacheConversation(Conversation conversation) async {
    final db = await _db;
    await db.insert(
      'conversations_cache',
      {
        'id': conversation.id,
        'payload': jsonEncode(conversation.toJson()),
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Conversation?> conversation(String id) async {
    final db = await _db;
    final rows = await db.query(
      'conversations_cache',
      columns: const ['payload'],
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return Conversation.fromJson(
      (jsonDecode(rows.single['payload']! as String) as Map)
          .cast<String, dynamic>(),
    );
  }

  Future<void> upsertMessage(TranslationMessage message) async {
    if (message.sequence <= 0 || message.id.isEmpty) return;
    final db = await _db;
    await db.transaction((txn) async {
      // A sequence is authoritative within one conversation. Remove an older
      // provisional ID before replacing it with the server's final message.
      await txn.delete(
        'messages_cache',
        where: 'conversation_id = ? AND sequence = ? AND id != ?',
        whereArgs: [message.conversationId, message.sequence, message.id],
      );
      await txn.insert(
        'messages_cache',
        {
          'id': message.id,
          'conversation_id': message.conversationId,
          'sequence': message.sequence,
          'payload': message.encode(),
          'updated_at': DateTime.now().millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
  }

  Future<void> upsertMessages(Iterable<TranslationMessage> messages) async {
    for (final message in messages) {
      await upsertMessage(message);
    }
  }

  Future<List<TranslationMessage>> messages(String conversationId) async {
    final db = await _db;
    final rows = await db.query(
      'messages_cache',
      columns: const ['payload'],
      where: 'conversation_id = ?',
      whereArgs: [conversationId],
      orderBy: 'sequence ASC',
    );
    return rows
        .map((row) => TranslationMessage.decode(row['payload']! as String))
        .where((message) => message.conversationId == conversationId)
        .toList(growable: false);
  }

  Future<int> lastSequence(String conversationId) async {
    final db = await _db;
    final result = await db.rawQuery(
      'SELECT MAX(sequence) AS value FROM messages_cache WHERE conversation_id = ?',
      [conversationId],
    );
    return (result.single['value'] as num?)?.toInt() ?? 0;
  }

  Future<void> deleteConversation(String conversationId) async {
    final db = await _db;
    await db.transaction((txn) async {
      await txn.delete(
        'messages_cache',
        where: 'conversation_id = ?',
        whereArgs: [conversationId],
      );
      await txn.delete(
        'conversations_cache',
        where: 'id = ?',
        whereArgs: [conversationId],
      );
    });
  }

  Future<String?> preference(String key) async {
    final db = await _db;
    final rows = await db.query(
      'preferences',
      columns: const ['value'],
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.single['value'] as String;
  }

  Future<void> setPreference(String key, String value) async {
    final db = await _db;
    await db.insert(
      'preferences',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Called on logout/account deletion so the next local user cannot see a
  /// previous user's cached customer or meeting data. Playback preferences stay.
  Future<void> clearPrivateData() async {
    final db = await _db;
    await db.transaction((txn) async {
      await txn.delete('messages_cache');
      await txn.delete('conversations_cache');
    });
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
