import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/auth/secure_token_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test('ordinary logout keeps the stable guest principal capability', () async {
    final store = SecureTokenStore();
    await store.writeTokens(accessToken: 'access', refreshToken: 'refresh');
    await store.writeGuestRefreshContext(
      principalToken: 'principal-token',
      conversationId: 'conversation-a',
    );

    await store.clearTokens();

    expect(await store.readAccessToken(), isNull);
    expect(await store.readRefreshToken(), isNull);
    expect(await store.readGuestPrincipalToken(), 'principal-token');
    expect(await store.readGuestConversationId(), isNull);
  });

  test('explicit guest identity deletion clears its principal capability',
      () async {
    final store = SecureTokenStore();
    await store.writeGuestPrincipalToken('principal-token');

    await store.clearGuestPrincipalToken();

    expect(await store.readGuestPrincipalToken(), isNull);
    expect(await store.readGuestConversationId(), isNull);
  });
}
