import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/api/api_client.dart';
import 'package:tooyei_translator/core/auth/auth_repository.dart';
import 'package:tooyei_translator/core/auth/secure_token_store.dart';
import 'package:tooyei_translator/core/models.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('guest 401 renews by principal scope once and retries the request',
      () async {
    final store = SecureTokenStore();
    await store.writeTokens(accessToken: 'expired-access', refreshToken: '');
    await store.writeGuestRefreshContext(
      principalToken: 'principal-token-12345678901234567890',
      conversationId: 'conversation-a',
    );
    final deviceId = await store.deviceId();
    Map<String, dynamic>? refreshBody;
    var protectedRequests = 0;
    final adapter = _CallbackAdapter((options) {
      if (options.path.endsWith('/auth/guest/refresh')) {
        refreshBody = (options.data as Map).cast<String, dynamic>();
        return _json(200, {
          'ok': true,
          'data': {
            'accessToken': 'renewed-access',
            'conversationId': 'conversation-a',
            'guestIdentityId': 'guest-a',
            'role': 'GUEST',
          },
        });
      }
      protectedRequests += 1;
      if (options.headers['Authorization'] != 'Bearer renewed-access') {
        return _json(401, {
          'ok': false,
          'code': 'TOKEN_INVALID',
          'message': 'expired',
        });
      }
      return _json(200, {
        'ok': true,
        'data': {'id': 'conversation-a'},
      });
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'))
      ..httpClientAdapter = adapter;
    final api = ApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenStore: store,
      dio: dio,
    );

    final result = await api.getMap('/conversations/conversation-a');

    expect(result['id'], 'conversation-a');
    expect(protectedRequests, 2);
    expect(refreshBody, {
      'guestPrincipalToken': 'principal-token-12345678901234567890',
      'conversationId': 'conversation-a',
      'deviceId': deviceId,
    });
    expect(await store.readAccessToken(), 'renewed-access');
    expect(await store.readRefreshToken(), isNull);
    expect(await store.readGuestConversationId(), 'conversation-a');
  });

  test('registered refresh remains preferred over stored guest capability',
      () async {
    final store = SecureTokenStore();
    await store.writeTokens(
      accessToken: 'expired-user-access',
      refreshToken: 'formal-refresh',
    );
    await store.writeGuestRefreshContext(
      principalToken: 'principal-token-12345678901234567890',
      conversationId: 'old-guest-conversation',
    );
    var formalRefreshes = 0;
    var guestRefreshes = 0;
    final adapter = _CallbackAdapter((options) {
      if (options.path.endsWith('/auth/refresh')) {
        formalRefreshes += 1;
        return _json(200, {
          'ok': true,
          'data': {
            'accessToken': 'renewed-user-access',
            'refreshToken': 'rotated-formal-refresh',
          },
        });
      }
      if (options.path.endsWith('/auth/guest/refresh')) {
        guestRefreshes += 1;
        return _json(500, {'ok': false});
      }
      if (options.headers['Authorization'] != 'Bearer renewed-user-access') {
        return _json(401, {'ok': false, 'code': 'TOKEN_INVALID'});
      }
      return _json(200, {
        'ok': true,
        'data': {'id': 'user-a'},
      });
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'))
      ..httpClientAdapter = adapter;
    final api = ApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenStore: store,
      dio: dio,
    );

    await api.getMap('/auth/me');

    expect(formalRefreshes, 1);
    expect(guestRefreshes, 0);
    expect(await store.readRefreshToken(), 'rotated-formal-refresh');
  });

  test('cold restore renews an expired guest access token without an invite',
      () async {
    final store = SecureTokenStore();
    await store.writeTokens(
        accessToken: 'expired-guest-access', refreshToken: '');
    await store.writeGuestRefreshContext(
      principalToken: 'principal-token-12345678901234567890',
      conversationId: 'conversation-a',
    );
    final adapter = _CallbackAdapter((options) {
      if (options.path.endsWith('/auth/guest/refresh')) {
        return _json(200, {
          'ok': true,
          'data': {
            'accessToken': 'restored-guest-access',
            'conversationId': 'conversation-a',
            'guestIdentityId': 'guest-a',
            'role': 'GUEST',
          },
        });
      }
      if (options.headers['Authorization'] != 'Bearer restored-guest-access') {
        return _json(401, {'ok': false, 'code': 'TOKEN_INVALID'});
      }
      return _json(200, {
        'ok': true,
        'data': {
          'id': 'guest-a',
          'role': 'GUEST',
          'displayName': 'Иван',
          'company': 'Example LLC',
          'preferredLanguage': 'ru',
          'conversationId': 'conversation-a',
        },
      });
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'))
      ..httpClientAdapter = adapter;
    final api = ApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenStore: store,
      dio: dio,
    );

    final restored = await AuthRepository(api, store).restore();

    expect(restored?.userId, 'guest-a');
    expect(restored?.role, UserRole.guest);
    expect(restored?.currentConversationId, 'conversation-a');
    expect(await store.readAccessToken(), 'restored-guest-access');
  });
}

final class _CallbackAdapter implements HttpClientAdapter {
  _CallbackAdapter(this.callback);

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

ResponseBody _json(int statusCode, Map<String, dynamic> body) =>
    ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
