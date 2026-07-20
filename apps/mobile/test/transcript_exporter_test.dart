import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/models.dart';
import 'package:tooyei_translator/core/utils/transcript_exporter.dart';

void main() {
  test('exports only final messages', () {
    final conversation = Conversation(
      id: 'conv-a',
      ownerId: 'host',
      contactId: 'ivan',
      contactName: 'Ivan',
      title: 'SPC 产品报价',
      status: ConversationStatus.ended,
      roomToken: 'token',
      roomCode: '123456',
      guestHistoryPolicy: GuestHistoryPolicy.accessFor24Hours,
      createdAt: DateTime.utc(2026, 7, 18),
      updatedAt: DateTime.utc(2026, 7, 18),
    );
    final finalMessage = TranslationMessage(
      id: 'm1',
      conversationId: 'conv-a',
      participantId: 'host',
      speakerRole: SpeakerRole.host,
      sourceLanguage: Language.zh,
      targetLanguage: Language.ru,
      sourceText: '这个产品有库存。',
      translatedText: 'Этот товар есть в наличии.',
      status: MessageStatus.finalResult,
      sequence: 1,
      createdAt: DateTime.utc(2026, 7, 18, 10, 20),
      displayName: '张伟',
      company: '图远科技',
      speakerLanguage: Language.zh,
      errorCode: 'TTS_FAILED',
      errorMessage: '语音合成失败',
    );
    final processing = TranslationMessage(
      id: 'm2',
      conversationId: 'conv-a',
      participantId: 'guest',
      speakerRole: SpeakerRole.guest,
      sourceLanguage: Language.ru,
      targetLanguage: Language.zh,
      sourceText: 'temporary',
      translatedText: '',
      status: MessageStatus.processing,
      sequence: 2,
      createdAt: DateTime.utc(2026, 7, 18, 10, 21),
    );
    final failed = TranslationMessage(
      id: 'm3',
      conversationId: 'conv-a',
      participantId: 'guest',
      speakerRole: SpeakerRole.guest,
      sourceLanguage: Language.ru,
      targetLanguage: Language.zh,
      sourceText: 'Перевод не завершён.',
      translatedText: '',
      status: MessageStatus.failed,
      sequence: 3,
      createdAt: DateTime.utc(2026, 7, 18, 10, 22),
      displayName: 'Ivan',
      company: 'RU Trade',
      speakerLanguage: Language.ru,
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: '供应商超时',
    );

    final text = TranscriptExporter.text(
      conversation,
      [finalMessage, processing, failed],
    );
    final markdown = TranscriptExporter.markdown(
      conversation,
      [finalMessage, processing, failed],
    );

    expect(text, contains('Ivan'));
    expect(text, contains('2026-07-18 10:20:00｜张伟｜图远科技｜中文'));
    expect(text, contains('原文：这个产品有库存。'));
    expect(text, contains('Этот товар есть в наличии.'));
    expect(text, contains('状态：已完成（TTS_FAILED：语音合成失败）'));
    expect(text, isNot(contains('PROVIDER_TIMEOUT')));
    expect(text, isNot(contains('Перевод не завершён.')));
    expect(text, isNot(contains('翻译失败')));
    expect(text, isNot(contains('temporary')));
    expect(markdown, contains('# SPC 产品报价'));
    expect(markdown, contains('`conv-a`'));
    expect(markdown, isNot(contains(r'PROVIDER\_TIMEOUT')));

    final russian = TranscriptExporter.text(
      conversation,
      [finalMessage],
      locale: const Locale('ru', 'RU'),
    );
    expect(russian, contains('Клиент: Ivan'));
    expect(russian, contains('Оригинал: 这个产品有库存。'));
    expect(russian, isNot(contains('主持人')));

    final grouped = TranscriptExporter.markdown(
      conversation,
      [finalMessage],
      groupBySpeaker: true,
    );
    expect(grouped, contains('## 张伟'));
    expect(grouped, contains('张伟｜图远科技｜中文'));
  });

  test('escapes markdown and prevents identity-line injection', () {
    final conversation = Conversation(
      id: 'conv-safe',
      ownerId: 'host',
      contactId: 'contact',
      contactName: '<script>alert(1)</script>',
      title: '# forged title',
      status: ConversationStatus.ended,
      roomToken: '',
      roomCode: '',
      guestHistoryPolicy: GuestHistoryPolicy.permanent,
      createdAt: DateTime.utc(2026, 7, 19),
      updatedAt: DateTime.utc(2026, 7, 19),
    );
    final message = TranslationMessage(
      id: 'message-safe',
      conversationId: conversation.id,
      participantId: 'participant',
      speakerRole: SpeakerRole.guest,
      sourceLanguage: Language.ru,
      targetLanguage: Language.zh,
      sourceText: 'первая строка\n2026｜伪造人员｜公司｜中文',
      translatedText: '<img src=x onerror=alert(1)>',
      status: MessageStatus.finalResult,
      sequence: 1,
      createdAt: DateTime.utc(2026, 7, 19, 1),
      displayName: 'Иван\n伪造人员',
      company: 'Компания\r\n第二行',
      speakerLanguage: Language.ru,
    );

    final text = TranscriptExporter.text(conversation, [message]);
    final markdown = TranscriptExporter.markdown(conversation, [message]);

    expect(text, contains('Иван 伪造人员｜Компания 第二行｜俄语'));
    expect(text, contains('первая строка\n  2026｜伪造人员'));
    expect(markdown, contains(r'\# forged title'));
    expect(markdown, contains(r'\<script\>alert\(1\)\</script\>'));
    expect(markdown, contains(r'\<img src=x onerror=alert\(1\)\>'));
  });
}
