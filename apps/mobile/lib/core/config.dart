final class AppConfig {
  const AppConfig._();

  static const _rawApiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://www.ruscny.net',
  );
  static const _rawSocketUrl = String.fromEnvironment(
    'SOCKET_URL',
    defaultValue: '',
  );
  static const appLinkHost = String.fromEnvironment(
    'APP_LINK_HOST',
    defaultValue: 'www.ruscny.net',
  );

  /// The backend contract is always rooted at `/v1`. This accepts either a
  /// host-only value or an already versioned value to avoid double prefixes.
  static String get apiBaseUrl {
    final normalized = _rawApiBaseUrl.replaceFirst(RegExp(r'/+$'), '');
    return normalized.endsWith('/v1') ? normalized : '$normalized/v1';
  }

  /// Socket.IO is served by the API origin in the default deployment. An
  /// explicit SOCKET_URL can still route realtime traffic independently.
  static String get socketUrl {
    final explicit = _rawSocketUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    if (explicit.isNotEmpty) return explicit;
    final api = Uri.parse(_rawApiBaseUrl.trim());
    return Uri(
      scheme: api.scheme,
      userInfo: api.userInfo,
      host: api.host,
      port: api.hasPort ? api.port : null,
    ).toString().replaceFirst(RegExp(r'/+$'), '');
  }

  static Uri inviteUri(String roomToken) =>
      Uri.https(appLinkHost, '/join/$roomToken');
}
