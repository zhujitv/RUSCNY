import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/api/api_client.dart';
import 'package:tooyei_translator/core/auth/secure_token_store.dart';
import 'package:tooyei_translator/features/conversations/conversation_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('viewing a summary is read-only and generation requires explicit POST',
      () async {
    final requests = <RequestOptions>[];
    final adapter = _SummaryAdapter((options) {
      requests.add(options);
      return ResponseBody.fromString(
        jsonEncode({
          'ok': true,
          'data': {
            'summary': {
              'summary': '报价讨论',
              'participantRoster': [],
              'coreDiscussion': [],
              'partyViews': [],
              'confirmedItems': [],
              'actionItems': [],
              'openQuestions': [],
              'sourceMaxSequence': 5,
              'sourceMessageCount': 5,
              'revision': options.method == 'GET' ? 2 : 3,
              'isStale': false,
              'generatedAt': '2026-07-19T10:30:00Z',
            },
          },
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'))
      ..httpClientAdapter = adapter;
    final repository = ConversationRepository(
      ApiClient(
        baseUrl: 'https://api.example.test/v1',
        tokenStore: SecureTokenStore(),
        dio: dio,
      ),
    );

    final viewed = await repository.summary('conversation/a');
    final regenerated = await repository.generateSummary('conversation/a');

    expect(viewed.revision, 2);
    expect(regenerated.revision, 3);
    expect(requests, hasLength(2));
    expect(requests[0].method, 'GET');
    expect(
        requests[0].path, endsWith('/conversations/conversation%2Fa/summary'));
    expect(requests[1].method, 'POST');
    expect(
        requests[1].path, endsWith('/conversations/conversation%2Fa/summary'));
    expect(requests[1].data, isEmpty);
  });

  test('loads eligible email recipients and sends an idempotent distribution',
      () async {
    final requests = <RequestOptions>[];
    final adapter = _SummaryAdapter((options) {
      requests.add(options);
      final isRecipients = options.path.endsWith('/email-recipients');
      final isStartDistribution = options.method == 'POST';
      return ResponseBody.fromString(
        jsonEncode({
          'ok': true,
          'data': isRecipients
              ? {
                  'summaryRevision': 4,
                  'isStale': false,
                  'items': [
                    {
                      'participantId': 'participant-a',
                      'displayName': 'Ivan',
                      'company': 'RU Co',
                      'emailHint': 'i***n@example.test',
                      'preferredLanguage': 'ru',
                      'eligible': true,
                    },
                  ],
                }
              : {
                  'distribution': {
                    'id': 'distribution-a',
                    'status': isStartDistribution ? 'PROCESSING' : 'COMPLETED',
                    'summaryRevision': 4,
                    'recipientCount': 1,
                    'sentCount': isStartDistribution ? 0 : 1,
                    'failedCount': 0,
                    'recipients': [
                      {
                        'participantId': 'participant-a',
                        'displayName': 'Ivan',
                        'emailHint': 'i***n@example.test',
                        'status': isStartDistribution ? 'PENDING' : 'SENT',
                      },
                    ],
                  },
                },
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'))
      ..httpClientAdapter = adapter;
    final repository = ConversationRepository(
      ApiClient(
        baseUrl: 'https://api.example.test/v1',
        tokenStore: SecureTokenStore(),
        dio: dio,
      ),
    );

    final recipients =
        await repository.summaryEmailRecipients('conversation/a');
    final distribution = await repository.distributeSummaryEmail(
      conversationId: 'conversation/a',
      participantIds: const ['participant-a'],
      idempotencyKey: 'distribution-request-a',
    );

    expect(recipients.summaryRevision, 4);
    expect(recipients.items.single.emailHint, 'i***n@example.test');
    expect(distribution.sentCount, 1);
    expect(requests[1].headers['Idempotency-Key'], 'distribution-request-a');
    expect(requests[1].data, {
      'participantIds': ['participant-a'],
    });
    expect(requests[2].method, 'GET');
    expect(
      requests[2].path,
      '/conversations/conversation%2Fa/summary/email-distributions/distribution-a',
    );
  });
}

final class _SummaryAdapter implements HttpClientAdapter {
  _SummaryAdapter(this.callback);

  final ResponseBody Function(RequestOptions options) callback;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async =>
      callback(options);

  @override
  void close({bool force = false}) {}
}
