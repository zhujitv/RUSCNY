import 'package:dio/dio.dart';

import '../../core/api/api_client.dart';
import '../../core/models.dart';
import 'face_to_face_models.dart';

abstract interface class FaceToFaceTranslator {
  Future<FaceToFaceTranslation> translate({
    required String path,
    required Language sourceLanguage,
    required String idempotencyKey,
    CancelToken? cancelToken,
  });
}

final class FaceToFaceRepository implements FaceToFaceTranslator {
  const FaceToFaceRepository(this._api);

  final ApiClient _api;

  @override
  Future<FaceToFaceTranslation> translate({
    required String path,
    required Language sourceLanguage,
    required String idempotencyKey,
    CancelToken? cancelToken,
  }) async {
    final targetLanguage = sourceLanguage.opposite;
    final form = FormData()
      ..fields.addAll([
        MapEntry('sourceLanguage', sourceLanguage.code),
        MapEntry('targetLanguage', targetLanguage.code),
      ])
      ..files.add(
        MapEntry(
          'audio',
          await MultipartFile.fromFile(
            path,
            filename: '$idempotencyKey.m4a',
          ),
        ),
      );
    final payload = await _api.postMap(
      '/face-to-face/translate',
      data: form,
      options: Options(
        headers: {'Idempotency-Key': idempotencyKey},
        contentType: 'multipart/form-data',
      ),
      cancelToken: cancelToken,
    );
    final result = FaceToFaceTranslation.fromJson(payload);
    if (result.idempotencyKey != idempotencyKey ||
        result.sourceLanguage != sourceLanguage ||
        result.targetLanguage != targetLanguage ||
        result.sourceText.isEmpty ||
        result.translatedText.isEmpty) {
      throw const FormatException('Invalid face-to-face translation response');
    }
    return result;
  }
}
