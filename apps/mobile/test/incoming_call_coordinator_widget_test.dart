import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/api/api_client.dart';
import 'package:tooyei_translator/core/auth/secure_token_store.dart';
import 'package:tooyei_translator/core/models.dart';
import 'package:tooyei_translator/core/providers.dart';
import 'package:tooyei_translator/features/friends/friend_repository.dart';
import 'package:tooyei_translator/features/friends/incoming_call_coordinator.dart';
import 'package:tooyei_translator/features/friends/social_realtime_controller.dart';

const _audioChannel = MethodChannel('com.tooyei.translator/audio_cues');
const _permissionChannel = MethodChannel(
  'flutter.baseflow.com/permissions/methods',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  tearDown(() {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(_audioChannel, null);
    messenger.setMockMethodCallHandler(_permissionChannel, null);
  });

  testWidgets('REST null closes a stale native incoming-call notification',
      (tester) async {
    final closedCallIds = <String>[];
    final acknowledgedActions = <Map<String, dynamic>>[];
    var actionAcknowledged = false;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(_audioChannel, (call) async {
      switch (call.method) {
        case 'consumeIncomingCallAction':
          if (actionAcknowledged) return null;
          return {'action': 'show', 'callId': 'stale-call'};
        case 'ackIncomingCallAction':
          final arguments = (call.arguments as Map).cast<String, dynamic>();
          acknowledgedActions.add(arguments);
          actionAcknowledged = true;
          return true;
        case 'closeIncomingCall':
          final arguments = (call.arguments as Map).cast<String, dynamic>();
          closedCallIds.add(arguments['callId']!.toString());
          return null;
        default:
          return null;
      }
    });
    messenger.setMockMethodCallHandler(
      _permissionChannel,
      (call) async => call.method == 'requestPermissions' ? <int, int>{} : null,
    );

    final realtime = SocialRealtimeController(
      accessToken: () async => null,
      recoverAuthentication: () async {},
      authenticationLost: () async {},
    );
    final container = ProviderContainer(
      overrides: [
        friendRepositoryProvider.overrideWithValue(_nullCallRepository()),
        socialRealtimeProvider.overrideWith((ref) => realtime),
      ],
    );

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          home: IncomingFriendCallCoordinator(
            session: AuthSession(
              userId: 'user-1',
              role: UserRole.user,
              displayName: 'User',
            ),
            child: SizedBox.shrink(),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));

    expect(closedCallIds, ['stale-call']);
    expect(acknowledgedActions, [
      {'action': 'show', 'callId': 'stale-call'},
    ]);

    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('successful native decline is acknowledged exactly once',
      (tester) async {
    final acknowledgedActions = <Map<String, dynamic>>[];
    var responseCount = 0;
    var actionAcknowledged = false;
    _installPlatformHandlers((call) async {
      switch (call.method) {
        case 'consumeIncomingCallAction':
          return actionAcknowledged
              ? null
              : {'action': 'decline', 'callId': 'call-1'};
        case 'ackIncomingCallAction':
          final arguments = (call.arguments as Map).cast<String, dynamic>();
          acknowledgedActions.add(arguments);
          actionAcknowledged = true;
          return true;
        default:
          return null;
      }
    });
    final repository = _callRepository((options, handler) {
      if (options.path.endsWith('/friend-calls/active')) {
        handler.resolve(_response(options, _activeCallBody()));
        return;
      }
      if (options.path.endsWith('/friend-calls/call-1/respond')) {
        responseCount += 1;
        handler.resolve(
          _response(options, _activeCallBody(status: 'DECLINED')),
        );
        return;
      }
      handler.reject(_unexpectedRequest(options));
    });
    final container = _container(repository);

    await _pumpCoordinator(tester, container);

    expect(responseCount, 1);
    expect(acknowledgedActions, [
      {'callId': 'call-1', 'action': 'decline'},
    ]);

    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('compare failure preserves a newer native action',
      (tester) async {
    Map<String, String>? nativeAction = {
      'action': 'show',
      'callId': 'stale-call',
    };
    final acknowledgedActions = <Map<String, dynamic>>[];
    _installPlatformHandlers((call) async {
      switch (call.method) {
        case 'consumeIncomingCallAction':
          return nativeAction;
        case 'ackIncomingCallAction':
          final arguments = (call.arguments as Map).cast<String, dynamic>();
          acknowledgedActions.add(arguments);
          if (arguments['action'] == 'show') {
            nativeAction = {
              'action': 'answer',
              'callId': 'stale-call',
            };
            return false;
          }
          nativeAction = null;
          return true;
        default:
          return null;
      }
    });
    final container = _container(_nullCallRepository());

    await _pumpCoordinator(tester, container);
    await tester.pump(incomingCallRecoveryInterval);
    await tester.pump();

    expect(acknowledgedActions, [
      {'callId': 'stale-call', 'action': 'show'},
      {'callId': 'stale-call', 'action': 'answer'},
    ]);

    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('transient response failure keeps action without rapid replay',
      (tester) async {
    var responseCount = 0;
    var acknowledgementCount = 0;
    _installPlatformHandlers((call) async {
      switch (call.method) {
        case 'consumeIncomingCallAction':
          return {'action': 'decline', 'callId': 'call-1'};
        case 'ackIncomingCallAction':
          acknowledgementCount += 1;
          return true;
        default:
          return null;
      }
    });
    final repository = _callRepository((options, handler) {
      if (options.path.endsWith('/friend-calls/active')) {
        handler.resolve(_response(options, _activeCallBody()));
        return;
      }
      if (options.path.endsWith('/friend-calls/call-1/respond')) {
        responseCount += 1;
        handler.reject(
          DioException(
            requestOptions: options,
            response: Response<dynamic>(
              requestOptions: options,
              statusCode: 503,
              data: {'ok': false, 'code': 'TEMPORARY_UNAVAILABLE'},
            ),
            type: DioExceptionType.badResponse,
          ),
        );
        return;
      }
      handler.reject(_unexpectedRequest(options));
    });
    final container = _container(repository);

    await _pumpCoordinator(tester, container);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();

    expect(responseCount, 1);
    expect(acknowledgementCount, 0);

    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('authoritative state change acknowledges persisted action',
      (tester) async {
    final acknowledgedActions = <Map<String, dynamic>>[];
    _installPlatformHandlers((call) async {
      switch (call.method) {
        case 'consumeIncomingCallAction':
          return {'action': 'answer', 'callId': 'call-1'};
        case 'ackIncomingCallAction':
          acknowledgedActions.add(
            (call.arguments as Map).cast<String, dynamic>(),
          );
          return true;
        default:
          return null;
      }
    });
    final repository = _callRepository((options, handler) {
      if (options.path.endsWith('/friend-calls/active')) {
        handler.resolve(_response(options, _activeCallBody()));
        return;
      }
      if (options.path.endsWith('/friend-calls/call-1/respond')) {
        handler.reject(
          DioException(
            requestOptions: options,
            response: Response<dynamic>(
              requestOptions: options,
              statusCode: 409,
              data: {
                'ok': false,
                'code': 'FRIEND_CALL_STATE_CHANGED',
                'message': '通话状态已经变化',
              },
            ),
            type: DioExceptionType.badResponse,
          ),
        );
        return;
      }
      handler.reject(_unexpectedRequest(options));
    });
    final container = _container(repository);

    await _pumpCoordinator(tester, container);

    expect(acknowledgedActions, [
      {'callId': 'call-1', 'action': 'answer'},
    ]);

    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });
}

void _installPlatformHandlers(
  Future<Object?> Function(MethodCall call) audioHandler,
) {
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(_audioChannel, audioHandler);
  messenger.setMockMethodCallHandler(
    _permissionChannel,
    (call) async => call.method == 'requestPermissions' ? <int, int>{} : null,
  );
}

ProviderContainer _container(FriendRepository repository) {
  final realtime = SocialRealtimeController(
    accessToken: () async => null,
    recoverAuthentication: () async {},
    authenticationLost: () async {},
  );
  return ProviderContainer(
    overrides: [
      friendRepositoryProvider.overrideWithValue(repository),
      socialRealtimeProvider.overrideWith((ref) => realtime),
    ],
  );
}

Future<void> _pumpCoordinator(
  WidgetTester tester,
  ProviderContainer container,
) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        home: IncomingFriendCallCoordinator(
          session: AuthSession(
            userId: 'user-1',
            role: UserRole.user,
            displayName: 'User',
          ),
          child: SizedBox.shrink(),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 10));
}

FriendRepository _callRepository(
  void Function(RequestOptions, RequestInterceptorHandler) onRequest,
) {
  final tokenStore = SecureTokenStore();
  final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'));
  dio.interceptors.add(InterceptorsWrapper(onRequest: onRequest));
  return FriendRepository(
    ApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenStore: tokenStore,
      dio: dio,
    ),
  );
}

Response<dynamic> _response(
  RequestOptions options,
  Map<String, dynamic> data,
) =>
    Response<dynamic>(
      requestOptions: options,
      statusCode: 200,
      data: data,
    );

Map<String, dynamic> _activeCallBody({String status = 'RINGING'}) => {
      'ok': true,
      'data': {
        'call': {
          'id': 'call-1',
          'direction': 'INCOMING',
          'status': status,
          'mediaType': 'AUDIO',
          'createdAt': DateTime.now().toUtc().toIso8601String(),
          'peer': {'id': 'friend-1', 'displayName': 'Ivan'},
        },
      },
    };

DioException _unexpectedRequest(RequestOptions options) => DioException(
      requestOptions: options,
      error: StateError('Unexpected request: ${options.path}'),
    );

FriendRepository _nullCallRepository() {
  final tokenStore = SecureTokenStore();
  final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/v1'));
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: {
              'ok': true,
              'data': {'call': null},
            },
          ),
        );
      },
    ),
  );
  return FriendRepository(
    ApiClient(
      baseUrl: 'https://api.example.test/v1',
      tokenStore: tokenStore,
      dio: dio,
    ),
  );
}
