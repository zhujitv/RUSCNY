import 'dart:io';

import 'package:cross_file/cross_file.dart';
import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../localization/app_localization.dart';
import '../models.dart';

final class TranscriptExporter {
  const TranscriptExporter._();

  static String text(
    Conversation conversation,
    List<TranslationMessage> messages, {
    Locale locale = const Locale('zh', 'CN'),
    bool groupBySpeaker = false,
  }) {
    String tr(String value) =>
        AppLocalization.translateForLocale(value, locale);
    final separator = locale.languageCode == 'ru' ? ': ' : '：';
    final buffer = StringBuffer()
      ..writeln(conversation.title ?? tr('中俄翻译记录'))
      ..writeln(
          '${tr('客户')}$separator${conversation.contactName ?? conversation.contactId}')
      ..writeln('${tr('会议')}$separator${conversation.id}')
      ..writeln();
    for (final message in _ordered(messages, groupBySpeaker: groupBySpeaker)) {
      buffer
        ..writeln(_identityLine(message, tr))
        ..writeln(
          '${tr('状态')}$separator${_identityField(_statusText(message, tr))}',
        )
        ..writeln(
          '${tr('原文')}$separator${_plainBody(_sourceText(message, tr))}',
        )
        ..writeln(
          '${tr('译文')}$separator${_plainBody(_translatedText(message, tr))}',
        )
        ..writeln();
    }
    return buffer.toString();
  }

  static String markdown(
    Conversation conversation,
    List<TranslationMessage> messages, {
    Locale locale = const Locale('zh', 'CN'),
    bool groupBySpeaker = false,
  }) {
    String tr(String value) =>
        AppLocalization.translateForLocale(value, locale);
    final separator = locale.languageCode == 'ru' ? ': ' : '：';
    final buffer = StringBuffer()
      ..writeln('# ${_markdown(conversation.title ?? tr('中俄翻译记录'))}')
      ..writeln()
      ..writeln(
          '- ${tr('客户')}$separator${_markdown(conversation.contactName ?? conversation.contactId)}')
      ..writeln('- ${tr('会话 ID')}$separator`${conversation.id}`')
      ..writeln();
    String? currentParticipantId;
    for (final message in _ordered(messages, groupBySpeaker: groupBySpeaker)) {
      final speaker = message.displayName ?? tr('参会者');
      if (groupBySpeaker && message.participantId != currentParticipantId) {
        buffer
          ..writeln('## ${_markdown(_identityField(speaker))}')
          ..writeln();
        currentParticipantId = message.participantId;
      }
      buffer
        ..writeln(
          '${groupBySpeaker ? '###' : '##'} ${_markdown(_identityLine(message, tr))}',
        )
        ..writeln()
        ..writeln(
          '**${tr('状态')}**$separator${_markdown(_identityField(_statusText(message, tr)))}',
        )
        ..writeln()
        ..writeln(
          '**${tr(message.sourceLanguage.label)} ${tr('原文')}**$separator${_markdown(_sourceText(message, tr))}',
        )
        ..writeln()
        ..writeln(
          '**${tr(message.targetLanguage.label)} ${tr('译文')}**$separator${_markdown(_translatedText(message, tr))}',
        )
        ..writeln();
    }
    return buffer.toString();
  }

  static Future<XFile> temporaryFile(
    Conversation conversation,
    List<TranslationMessage> messages, {
    required bool markdownFormat,
    Locale locale = const Locale('zh', 'CN'),
    bool groupBySpeaker = false,
  }) async {
    final directory = await getTemporaryDirectory();
    final exportDirectory = Directory(p.join(directory.path, 'tooyei-exports'));
    await exportDirectory.create(recursive: true);
    final safeTitle = (conversation.title ?? 'translation-${conversation.id}')
        .replaceAll(RegExp(r'[^\w\u4e00-\u9fff-]+'), '-')
        .replaceAll(RegExp(r'-+'), '-');
    final extension = markdownFormat ? 'md' : 'txt';
    final suffix = DateTime.now().microsecondsSinceEpoch;
    final path = p.join(exportDirectory.path, '$safeTitle-$suffix.$extension');
    final file = File(path);
    await file.writeAsString(
      markdownFormat
          ? markdown(
              conversation,
              messages,
              locale: locale,
              groupBySpeaker: groupBySpeaker,
            )
          : text(
              conversation,
              messages,
              locale: locale,
              groupBySpeaker: groupBySpeaker,
            ),
      flush: true,
    );
    return XFile(
      file.path,
      mimeType: markdownFormat ? 'text/markdown' : 'text/plain',
      name: p.basename(file.path),
    );
  }

  static Future<void> deleteTemporaryFile(XFile file) async {
    try {
      final exportRoot = p.normalize(
        p.join((await getTemporaryDirectory()).path, 'tooyei-exports'),
      );
      final candidate = p.normalize(file.path);
      if (p.isWithin(exportRoot, candidate)) {
        final target = File(candidate);
        if (await target.exists()) await target.delete();
      }
    } catch (_) {
      // Export cleanup is best effort and must not turn a successful share into
      // a user-visible failure.
    }
  }

  static Future<void> clearTemporaryFiles() async {
    try {
      final directory = Directory(
        p.join((await getTemporaryDirectory()).path, 'tooyei-exports'),
      );
      if (!await directory.exists()) return;
      await for (final entity in directory.list(followLinks: false)) {
        if (entity is File) await entity.delete();
      }
    } catch (_) {
      // Logout/account removal still proceeds if an OS-managed cache entry is
      // already gone or temporarily unavailable.
    }
  }

  static List<TranslationMessage> _ordered(
    List<TranslationMessage> messages, {
    required bool groupBySpeaker,
  }) {
    final terminalMessages = messages
        .where(
          (message) =>
              message.status == MessageStatus.finalResult ||
              message.status == MessageStatus.failed,
        )
        .toList(growable: false);
    if (!groupBySpeaker) return terminalMessages;
    final bySpeaker = <String, List<TranslationMessage>>{};
    for (final message in terminalMessages) {
      bySpeaker.putIfAbsent(message.participantId, () => []).add(message);
    }
    return [for (final group in bySpeaker.values) ...group];
  }

  static String _statusText(
    TranslationMessage message,
    String Function(String) tr,
  ) {
    final details = <String>{
      if (message.errorCode?.trim().isNotEmpty == true)
        message.errorCode!.trim(),
      if (message.errorMessage?.trim().isNotEmpty == true)
        message.errorMessage!.trim(),
    }.join('：');
    final base =
        message.status == MessageStatus.failed ? tr('翻译失败') : tr('已完成');
    return details.isEmpty ? base : '$base（$details）';
  }

  static String _sourceText(
    TranslationMessage message,
    String Function(String) tr,
  ) =>
      message.sourceText.trim().isEmpty
          ? '（${tr('未识别到原文')}）'
          : message.sourceText;

  static String _translatedText(
    TranslationMessage message,
    String Function(String) tr,
  ) {
    if (message.translatedText.trim().isNotEmpty) {
      return message.translatedText;
    }
    return message.status == MessageStatus.failed
        ? '（${tr('翻译失败，无译文')}）'
        : '（${tr('无译文')}）';
  }

  static String _identityLine(
    TranslationMessage message,
    String Function(String) tr,
  ) =>
      '${DateFormat('yyyy-MM-dd HH:mm:ss').format(message.createdAt)}｜'
      '${_identityField(message.displayName ?? tr('参会者'))}｜'
      '${_identityField(message.company?.isNotEmpty == true ? message.company! : '-')}｜'
      '${tr((message.speakerLanguage ?? message.sourceLanguage).label)}';

  static String _identityField(String value) =>
      value.replaceAll(RegExp(r'[\r\n\t\u0000-\u001f\u007f]+'), ' ').trim();

  static String _plainBody(String value) => value
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replaceAll('\n', '\n  ');

  static String _markdown(String value) => value
      .replaceAll('\\', r'\\')
      .replaceAllMapped(
        RegExp(r'[`*_{}\[\]()#+.!|<>-]'),
        (match) => '\\${match.group(0)}',
      )
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replaceAll('\n', '  \n');
}
