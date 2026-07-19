import '../../core/api/api_client.dart';

final class GlossaryTerm {
  const GlossaryTerm({
    required this.id,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.sourceTerm,
    required this.targetTerm,
    required this.enabled,
    this.category,
  });

  final String id;
  final String sourceLanguage;
  final String targetLanguage;
  final String sourceTerm;
  final String targetTerm;
  final String? category;
  final bool enabled;

  factory GlossaryTerm.fromJson(Map<String, dynamic> json) => GlossaryTerm(
        id: json['id'].toString(),
        sourceLanguage: json['sourceLanguage'].toString(),
        targetLanguage: json['targetLanguage'].toString(),
        sourceTerm: json['sourceTerm'].toString(),
        targetTerm: json['targetTerm'].toString(),
        category: json['category']?.toString(),
        enabled: json['enabled'] != false,
      );
}

final class GlossaryRepository {
  const GlossaryRepository(this._api);

  final ApiClient _api;

  Future<List<GlossaryTerm>> list() async {
    final rows = await _api.getList('/glossary');
    return rows
        .whereType<Map>()
        .map((row) => GlossaryTerm.fromJson(row.cast<String, dynamic>()))
        .toList(growable: false);
  }

  Future<GlossaryTerm> create({
    required String sourceLanguage,
    required String targetLanguage,
    required String sourceTerm,
    required String targetTerm,
    String? category,
  }) async =>
      GlossaryTerm.fromJson(
        await _api.postMap('/glossary', data: {
          'sourceLanguage': sourceLanguage,
          'targetLanguage': targetLanguage,
          'sourceTerm': sourceTerm.trim(),
          'targetTerm': targetTerm.trim(),
          'category': _clean(category),
          'enabled': true,
        }),
      );

  Future<GlossaryTerm> update(
    String id, {
    String? sourceLanguage,
    String? targetLanguage,
    String? sourceTerm,
    String? targetTerm,
    String? category,
    bool? enabled,
  }) async =>
      GlossaryTerm.fromJson(
        await _api.patchMap('/glossary/$id', data: {
          if (sourceLanguage != null) 'sourceLanguage': sourceLanguage,
          if (targetLanguage != null) 'targetLanguage': targetLanguage,
          if (sourceTerm != null) 'sourceTerm': sourceTerm.trim(),
          if (targetTerm != null) 'targetTerm': targetTerm.trim(),
          if (category != null) 'category': _clean(category),
          if (enabled != null) 'enabled': enabled,
        }),
      );

  Future<void> delete(String id) => _api.delete('/glossary/$id');

  static String? _clean(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }
}
