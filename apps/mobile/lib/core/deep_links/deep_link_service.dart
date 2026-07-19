import 'dart:async';

import 'package:app_links/app_links.dart';

import '../config.dart';

final class DeepLinkService {
  DeepLinkService({AppLinks? appLinks}) : _appLinks = appLinks ?? AppLinks();

  final AppLinks _appLinks;
  StreamSubscription<Uri>? _subscription;

  Future<void> start(void Function(String inviteToken) onInvite) async {
    await _subscription?.cancel();
    try {
      final initial = await _appLinks.getInitialLink();
      final initialToken = initial == null ? null : inviteToken(initial);
      if (initialToken != null) onInvite(initialToken);
    } catch (_) {
      // A platform link-channel failure must not prevent normal account login.
    }
    _subscription = _appLinks.uriLinkStream.listen(
      (uri) {
        final token = inviteToken(uri);
        if (token != null) onInvite(token);
      },
      onError: (_) {
        // The stream remains best-effort; QR/code entry is still available.
      },
    );
  }

  String? inviteToken(Uri uri) {
    if (uri.scheme == 'tooyei-translator' && uri.host == 'join') {
      return _validToken(
        uri.pathSegments.length == 1 ? uri.pathSegments.first : null,
      );
    }
    final segments = uri.pathSegments;
    final configured = Uri.https(AppConfig.appLinkHost, '/');
    if (uri.scheme == 'https' &&
        uri.authority.toLowerCase() == configured.authority.toLowerCase() &&
        segments.length == 2 &&
        segments.first == 'join') {
      return _validToken(segments.last);
    }
    return null;
  }

  static String? _validToken(String? value) {
    final token = value?.trim();
    return token != null && token.length >= 16 ? token : null;
  }

  Future<void> dispose() async => _subscription?.cancel();
}
