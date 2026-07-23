import '../../core/models.dart';

final class FaceToFaceTranslation {
  const FaceToFaceTranslation({
    required this.idempotencyKey,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.sourceText,
    required this.translatedText,
    this.audioUrl,
    this.audioStatus,
    this.errorCode,
  });

  final String idempotencyKey;
  final Language sourceLanguage;
  final Language targetLanguage;
  final String sourceText;
  final String translatedText;
  final String? audioUrl;
  final String? audioStatus;
  final String? errorCode;

  factory FaceToFaceTranslation.fromJson(Map<String, dynamic> json) =>
      FaceToFaceTranslation(
        idempotencyKey: (json['idempotencyKey'] ?? '').toString(),
        sourceLanguage: _language(json['sourceLanguage']),
        targetLanguage: _language(json['targetLanguage']),
        sourceText: (json['sourceText'] ?? '').toString().trim(),
        translatedText: (json['translatedText'] ?? '').toString().trim(),
        audioUrl: _optionalText(json['audioUrl']),
        audioStatus: _optionalText(json['audioStatus']),
        errorCode: _optionalText(json['errorCode']),
      );

  static Language _language(dynamic value) =>
      value?.toString().toLowerCase() == 'ru' ? Language.ru : Language.zh;

  static String? _optionalText(dynamic value) {
    final text = value?.toString().trim();
    return text?.isNotEmpty == true ? text : null;
  }
}

final class FaceToFaceTurn {
  const FaceToFaceTurn({
    required this.translation,
    required this.createdAt,
  });

  final FaceToFaceTranslation translation;
  final DateTime createdAt;

  String textFor(Language language) => translation.sourceLanguage == language
      ? translation.sourceText
      : translation.translatedText;

  bool hasAudioFor(Language language) =>
      translation.targetLanguage == language &&
      translation.audioUrl?.isNotEmpty == true;
}
