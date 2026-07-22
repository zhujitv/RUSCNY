import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/api/api_client.dart';
import 'package:tooyei_translator/core/auth/auth_repository.dart';
import 'package:tooyei_translator/core/auth/secure_token_store.dart';
import 'package:tooyei_translator/core/models.dart';
import 'package:tooyei_translator/core/notifications/push_registration_coordinator.dart';
import 'package:tooyei_translator/core/providers.dart';

const _pushChannel = MethodChannel(
  'com.tooyei.translator/push_notifications',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_pushChannel, null);
  });

  testWidgets(
    'rechecks a stable registration on bounded resume and applies kill switch',
    (tester) async {
      final incomingStates = <bool>[];
      _mockPushChannel(
        registration: () => _registration,
        incomingStates: incomingStates,
      );
      final server = _PushServer([true, false]);
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(server.repository),
        ],
      );

      await _mountCoordinator(tester, container);

      expect(server.calls, 1);
      expect(incomingStates, [true]);
      expect(
        container.read(pushRegistrationStateProvider),
        PushRegistrationState.ready,
      );

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await _flushAsync(tester);
      expect(server.calls, 1,
          reason: 'a quick lifecycle bounce is rate limited');

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(pushRegistrationServerRefreshInterval);
      expect(server.calls, 1,
          reason: 'background refresh does not use network');

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await _flushAsync(tester);

      expect(server.calls, 2);
      expect(incomingStates, [true, false]);
      expect(
        container.read(pushRegistrationStateProvider),
        PushRegistrationState.serverDisabled,
      );

      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    },
  );

  testWidgets('retries a temporarily unavailable native registration',
      (tester) async {
    var registrationRequests = 0;
    final incomingStates = <bool>[];
    _mockPushChannel(
      registration: () {
        registrationRequests += 1;
        return registrationRequests == 1 ? null : _registration;
      },
      incomingStates: incomingStates,
    );
    final server = _PushServer([true]);
    final container = ProviderContainer(
      overrides: [
        authRepositoryProvider.overrideWithValue(server.repository),
      ],
    );

    await _mountCoordinator(tester, container);

    expect(registrationRequests, 1);
    expect(server.calls, 0);
    expect(incomingStates, [false]);
    expect(
      container.read(pushRegistrationStateProvider),
      PushRegistrationState.unavailable,
    );

    await tester.pump(
      pushRegistrationRetryInterval - const Duration(seconds: 1),
    );
    expect(registrationRequests, 1);

    await tester.pump(const Duration(seconds: 1));
    await _flushAsync(tester);

    expect(registrationRequests, 2);
    expect(server.calls, 1);
    expect(incomingStates, [false, true]);
    expect(
      container.read(pushRegistrationStateProvider),
      PushRegistrationState.ready,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });
}

const _session = AuthSession(
  userId: 'user-1',
  role: UserRole.user,
  displayName: 'User',
);

const _registration = <String, String>{
  'registrationId': 'fcm-token',
  'bindingId': '06927bcd-9b16-4480-a031-33fbb4a84732',
};

Future<void> _mountCoordinator(
  WidgetTester tester,
  ProviderContainer container,
) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const Directionality(
        textDirection: TextDirection.ltr,
        child: PushRegistrationCoordinator(
          session: _session,
          child: SizedBox.shrink(),
        ),
      ),
    ),
  );
  await _flushAsync(tester);
}

Future<void> _flushAsync(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 1));
}

void _mockPushChannel({
  required Map<String, String>? Function() registration,
  required List<bool> incomingStates,
}) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_pushChannel, (call) async {
    switch (call.method) {
      case 'getRegistration':
        return registration();
      case 'setIncomingCallsEnabled':
        final arguments = (call.arguments as Map).cast<String, dynamic>();
        incomingStates.add(arguments['enabled'] == true);
        return null;
      case 'clearBinding':
        return null;
      default:
        return null;
    }
  });
}

final class _PushServer {
  _PushServer(List<bool> responses) : _responses = List.of(responses) {
    final tokenStore = SecureTokenStore();
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          calls += 1;
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              statusCode: 200,
              data: {
                'ok': true,
                'data': {
                  'registered': true,
                  'deliveryEnabled': _responses.removeAt(0),
                },
              },
            ),
          );
        },
      ),
    );
    repository = AuthRepository(
      ApiClient(
        baseUrl: 'https://api.example.test/v1',
        tokenStore: tokenStore,
        dio: dio,
      ),
      tokenStore,
    );
  }

  final List<bool> _responses;
  late final AuthRepository repository;
  int calls = 0;
}
