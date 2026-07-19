import '../../core/api/api_client.dart';
import '../../core/models.dart';

final class ContactRepository {
  const ContactRepository(this._api);

  final ApiClient _api;

  Future<List<Contact>> list({String? search}) async {
    final rows = await _api.getList(
      '/contacts',
      query: {if (search?.trim().isNotEmpty == true) 'search': search!.trim()},
    );
    return rows
        .whereType<Map>()
        .map((row) => Contact.fromJson(row.cast<String, dynamic>()))
        .toList(growable: false);
  }

  Future<Contact> get(String id) async => Contact.fromJson(
        await _api.getMap('/contacts/$id'),
      );

  Future<Contact> create({
    required String displayName,
    String? company,
    String? country,
    String? phone,
    String? email,
    String? notes,
  }) async =>
      Contact.fromJson(
        await _api.postMap('/contacts', data: {
          'displayName': displayName.trim(),
          'company': _clean(company),
          'country': _clean(country),
          'phone': _clean(phone),
          'email': _clean(email),
          'notes': _clean(notes),
        }),
      );

  Future<Contact> update(
    String id, {
    required String displayName,
    String? company,
    String? country,
    String? phone,
    String? email,
    String? notes,
  }) async =>
      Contact.fromJson(
        await _api.patchMap('/contacts/$id', data: {
          'displayName': displayName.trim(),
          'company': _clean(company),
          'country': _clean(country),
          'phone': _clean(phone),
          'email': _clean(email),
          'notes': _clean(notes),
        }),
      );

  Future<void> delete(String id) => _api.delete('/contacts/$id');

  static String? _clean(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }
}
