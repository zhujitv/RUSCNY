import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/features/friends/social_realtime_controller.dart';

void main() {
  group('social realtime connection error parsing', () {
    test('reads an authentication code from the root payload', () {
      expect(
        socialRealtimeConnectionErrorCode({
          'code': 'TOKEN_INVALID',
          'message': 'token expired',
        }),
        'TOKEN_INVALID',
      );
    });

    test('reads an authentication code nested in Socket.IO error data', () {
      expect(
        socialRealtimeConnectionErrorCode({
          'message': 'Authentication error',
          'data': {'code': 'TOKEN_EXPIRED'},
        }),
        'TOKEN_EXPIRED',
      );
    });

    test('reads an authentication code from a Socket error wrapper', () {
      expect(
        socialRealtimeConnectionErrorCode(
          _SocketErrorPayload({'code': 'UNAUTHORIZED'}),
        ),
        'UNAUTHORIZED',
      );
    });

    test('accepts the list envelope emitted by socket_io_client', () {
      expect(
        socialRealtimeConnectionErrorCode([
          {
            'message': 'Authentication error',
            'data': {'code': 'SESSION_REVOKED'},
          },
        ]),
        'SESSION_REVOKED',
      );
    });

    test('returns null for missing or malformed error data', () {
      expect(socialRealtimeConnectionErrorCode(null), isNull);
      expect(socialRealtimeConnectionErrorCode('connect failed'), isNull);
      expect(socialRealtimeConnectionErrorCode(const {}), isNull);
      expect(
        socialRealtimeConnectionErrorCode({
          'message': 'connect failed',
          'data': 'not structured',
        }),
        isNull,
      );
    });
  });

  group('social realtime authentication recovery decision', () {
    test('recovers for every server authentication failure code', () {
      for (final code in const [
        'UNAUTHORIZED',
        'TOKEN_INVALID',
        'TOKEN_EXPIRED',
        'SESSION_REVOKED',
      ]) {
        expect(
          isSocialRealtimeAuthenticationErrorCode(code),
          isTrue,
          reason: code,
        );
      }
    });

    test('does not refresh authentication for transport failures', () {
      expect(isSocialRealtimeAuthenticationErrorCode(null), isFalse);
      expect(isSocialRealtimeAuthenticationErrorCode(''), isFalse);
      expect(
        isSocialRealtimeAuthenticationErrorCode('TRANSPORT_ERROR'),
        isFalse,
      );
      expect(
        isSocialRealtimeAuthenticationErrorCode('token_invalid'),
        isFalse,
      );
    });
  });
}

final class _SocketErrorPayload {
  const _SocketErrorPayload(this.data);

  final Map<String, dynamic> data;
}
