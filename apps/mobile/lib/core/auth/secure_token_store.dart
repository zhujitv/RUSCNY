import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

final class SecureTokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  static const _accessKey = 'auth.access_token';
  static const _refreshKey = 'auth.refresh_token';
  static const _deviceKey = 'auth.device_id';
  static const _guestPrincipalKey = 'auth.guest_principal_token';
  static const _guestConversationKey = 'auth.guest_conversation_id';

  final FlutterSecureStorage _storage;

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  /// Stable, install-scoped guest identity capability. It deliberately
  /// survives ordinary logout so a removed guest cannot re-enter the same
  /// meeting by merely signing out and presenting its old invitation again.
  Future<String?> readGuestPrincipalToken() =>
      _storage.read(key: _guestPrincipalKey);

  /// The single meeting scope currently authorized on this install. It is
  /// stored separately from the durable principal capability so logout can
  /// end automatic renewal without erasing the install's stable identity.
  Future<String?> readGuestConversationId() =>
      _storage.read(key: _guestConversationKey);

  Future<void> writeGuestPrincipalToken(String token) =>
      _storage.write(key: _guestPrincipalKey, value: token);

  Future<void> writeGuestRefreshContext({
    required String principalToken,
    required String conversationId,
  }) async {
    await Future.wait([
      _storage.write(key: _guestPrincipalKey, value: principalToken),
      _storage.write(key: _guestConversationKey, value: conversationId),
    ]);
  }

  Future<void> clearGuestSessionScope() =>
      _storage.delete(key: _guestConversationKey);

  Future<void> clearGuestPrincipalToken() async {
    await Future.wait([
      _storage.delete(key: _guestPrincipalKey),
      _storage.delete(key: _guestConversationKey),
    ]);
  }

  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await Future.wait([
      _storage.write(key: _accessKey, value: accessToken),
      refreshToken.isEmpty
          ? _storage.delete(key: _refreshKey)
          : _storage.write(key: _refreshKey, value: refreshToken),
    ]);
  }

  Future<String> deviceId() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final generated = const Uuid().v4();
    await _storage.write(key: _deviceKey, value: generated);
    return generated;
  }

  /// Device ID deliberately survives logout, while all credentials are erased.
  Future<void> clearTokens() async {
    await Future.wait([
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshKey),
      _storage.delete(key: _guestConversationKey),
    ]);
  }
}
