import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/api/api_client.dart';
import 'package:tooyei_translator/core/auth/secure_token_store.dart';
import 'package:tooyei_translator/core/models.dart';
import 'package:tooyei_translator/features/face_to_face/face_to_face_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('uploads one ephemeral utterance with the fixed opposite language',
      () async {
    RequestOptions? captured;
    final adapter = _FaceAdapter((options) {
      captured = options;
      return _json({
        'ok': true,
        'data': {
          'idempotencyKey': 'turn-1',
          'sourceLanguage': 'zh',
          'targetLanguage': 'ru',
          'sourceText': '你好',
          'translatedText': 'Здравствуйте',
          'audioUrl': 'https://audio.test/turn-1.mp3',
          'audioStatus': 'READY',
        },
      });
    });
    final repository = _repository(adapter);
    final directory = await Directory.systemTemp.createTemp('face-repo-');
    final audio = File('${directory.path}/voice.m4a');
    await audio.writeAsBytes([1, 2, 3, 4]);

    try {
      final result = await repository.translate(
        path: audio.path,
        sourceLanguage: Language.zh,
        idempotencyKey: 'turn-1',
      );

      expect(captured?.path, '/face-to-face/translate');
      expect(captured?.headers['Idempotency-Key'], 'turn-1');
      final form = captured?.data as FormData;
      expect(
        {for (final field in form.fields) field.key: field.value},
        {'sourceLanguage': 'zh', 'targetLanguage': 'ru'},
      );
      expect(form.files.single.value.filename, 'turn-1.m4a');
      expect(result.sourceText, '你好');
      expect(result.translatedText, 'Здравствуйте');
      expect(result.audioUrl, 'https://audio.test/turn-1.mp3');
    } finally {
      await directory.delete(recursive: true);
    }
  });

  test('accepts text success when synthesized audio is unavailable', () async {
    final repository = _repository(_FaceAdapter((_) {
      return _json({
        'ok': true,
        'data': {
          'idempotencyKey': 'turn-2',
          'sourceLanguage': 'ru',
          'targetLanguage': 'zh',
          'sourceText': 'Где метро?',
          'translatedText': '地铁在哪里？',
          'audioUrl': null,
          'audioStatus': 'UNAVAILABLE',
          'errorCode': 'TTS_FAILED',
        },
      });
    }));
    final directory = await Directory.systemTemp.createTemp('face-repo-');
    final audio = File('${directory.path}/voice.m4a');
    await audio.writeAsBytes([1, 2, 3, 4]);

    try {
      final result = await repository.translate(
        path: audio.path,
        sourceLanguage: Language.ru,
        idempotencyKey: 'turn-2',
      );

      expect(result.translatedText, '地铁在哪里？');
      expect(result.audioUrl, isNull);
      expect(result.audioStatus, 'UNAVAILABLE');
      expect(result.errorCode, 'TTS_FAILED');
    } finally {
      await directory.delete(recursive: true);
    }
  });
}

FaceToFaceRepository _repository(HttpClientAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'))
    ..httpClientAdapter = adapter;
  return FaceToFaceRepository(
    ApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenStore: SecureTokenStore(),
      dio: dio,
    ),
  );
}

ResponseBody _json(Map<String, dynamic> body) => ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );

final class _FaceAdapter implements HttpClientAdapter {
  _FaceAdapter(this.callback);

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
