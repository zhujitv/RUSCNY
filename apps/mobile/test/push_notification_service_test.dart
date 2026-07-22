import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/notifications/push_notification_service.dart';

void main() {
  test('accepts only a complete token and account-binding pair', () {
    final registration = PushRegistration.fromMap({
      'registrationId': 'fcm-token',
      'bindingId': '06927bcd-9b16-4480-a031-33fbb4a84732',
    });

    expect(registration.isValid, isTrue);
    expect(
      registration.syncKey,
      'fcm-token:06927bcd-9b16-4480-a031-33fbb4a84732',
    );
    expect(PushRegistration.fromMap(null).isValid, isFalse);
  });

  test('parses native incoming-call notification capabilities', () {
    final status = PushNotificationStatus.fromMap({
      'configured': true,
      'hasRegistrationId': true,
      'incomingCallsEnabled': true,
      'notificationsEnabled': true,
      'channelEnabled': false,
      'fullScreenPermissionRequired': true,
      'fullScreenAllowed': false,
      'sdkInt': 35,
    });

    expect(status.configured, isTrue);
    expect(status.hasRegistrationId, isTrue);
    expect(status.incomingCallsEnabled, isTrue);
    expect(status.notificationsEnabled, isTrue);
    expect(status.channelEnabled, isFalse);
    expect(status.fullScreenPermissionRequired, isTrue);
    expect(status.fullScreenAllowed, isFalse);
    expect(status.sdkInt, 35);
  });

  test('uses safe unavailable defaults for a missing native bridge', () {
    final status = PushNotificationStatus.fromMap(null);

    expect(status.configured, isFalse);
    expect(status.hasRegistrationId, isFalse);
    expect(status.incomingCallsEnabled, isFalse);
    expect(status.notificationsEnabled, isFalse);
    expect(status.fullScreenAllowed, isFalse);
    expect(status.sdkInt, 0);
  });
}
