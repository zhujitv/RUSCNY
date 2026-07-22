import 'dart:async';

import 'package:flutter/services.dart';

final class PushRegistration {
  const PushRegistration({
    required this.registrationId,
    required this.bindingId,
  });

  factory PushRegistration.fromMap(Map<dynamic, dynamic>? value) {
    return PushRegistration(
      registrationId: value?['registrationId']?.toString().trim() ?? '',
      bindingId: value?['bindingId']?.toString().trim() ?? '',
    );
  }

  final String registrationId;
  final String bindingId;

  bool get isValid => registrationId.isNotEmpty && bindingId.isNotEmpty;
  String get syncKey => '$registrationId:$bindingId';
}

final class PushNotificationStatus {
  const PushNotificationStatus({
    required this.configured,
    required this.hasRegistrationId,
    required this.incomingCallsEnabled,
    required this.notificationsEnabled,
    required this.channelEnabled,
    required this.fullScreenPermissionRequired,
    required this.fullScreenAllowed,
    required this.sdkInt,
  });

  factory PushNotificationStatus.fromMap(Map<dynamic, dynamic>? value) {
    return PushNotificationStatus(
      configured: value?['configured'] == true,
      hasRegistrationId: value?['hasRegistrationId'] == true,
      incomingCallsEnabled: value?['incomingCallsEnabled'] == true,
      notificationsEnabled: value?['notificationsEnabled'] == true,
      channelEnabled: value?['channelEnabled'] == true,
      fullScreenPermissionRequired:
          value?['fullScreenPermissionRequired'] == true,
      fullScreenAllowed: value?['fullScreenAllowed'] == true,
      sdkInt: (value?['sdkInt'] as num?)?.toInt() ?? 0,
    );
  }

  static const unavailable = PushNotificationStatus(
    configured: false,
    hasRegistrationId: false,
    incomingCallsEnabled: false,
    notificationsEnabled: false,
    channelEnabled: false,
    fullScreenPermissionRequired: false,
    fullScreenAllowed: false,
    sdkInt: 0,
  );

  final bool configured;
  final bool hasRegistrationId;
  final bool incomingCallsEnabled;
  final bool notificationsEnabled;
  final bool channelEnabled;
  final bool fullScreenPermissionRequired;
  final bool fullScreenAllowed;
  final int sdkInt;
}

/// Native Android push bridge. Incoming messages themselves never pass through
/// this channel; the native Firebase service owns that time-critical path.
final class PushNotificationService {
  PushNotificationService._();

  static const _channel =
      MethodChannel('com.tooyei.translator/push_notifications');

  static Future<PushRegistration?> registration(String subjectId) async {
    try {
      final value = await _channel.invokeMapMethod<dynamic, dynamic>(
        'getRegistration',
        {'subjectId': subjectId},
      ).timeout(const Duration(seconds: 15));
      final registration = PushRegistration.fromMap(value);
      return registration.isValid ? registration : null;
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    } on TimeoutException {
      return null;
    }
  }

  static Future<PushNotificationStatus> status() async {
    try {
      final value = await _channel.invokeMapMethod<dynamic, dynamic>(
        'getStatus',
      );
      return PushNotificationStatus.fromMap(value);
    } on MissingPluginException {
      return PushNotificationStatus.unavailable;
    } on PlatformException {
      return PushNotificationStatus.unavailable;
    }
  }

  static void listenForRegistrationChanges(Future<void> Function() callback) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'registrationChanged') await callback();
    });
  }

  static void stopListeningForRegistrationChanges() {
    _channel.setMethodCallHandler(null);
  }

  static Future<void> setIncomingCallsEnabled(bool enabled) async {
    try {
      await _channel.invokeMethod<void>(
        'setIncomingCallsEnabled',
        {'enabled': enabled},
      );
    } on MissingPluginException {
      // Non-Android platforms do not have the native FCM bridge.
    } on PlatformException {
      // Authentication cleanup must still finish if platform state is damaged.
    }
  }

  static Future<void> clearBinding() async {
    try {
      await _channel.invokeMethod<void>('clearBinding');
    } on MissingPluginException {
      // Non-Android platforms do not have an incoming-call push binding.
    } on PlatformException {
      // Local authentication cleanup must remain best-effort and idempotent.
    }
  }

  static Future<bool> openNotificationSettings() =>
      _open('openNotificationSettings');

  static Future<bool> openIncomingCallChannelSettings() =>
      _open('openIncomingCallChannelSettings');

  static Future<bool> openFullScreenIntentSettings() =>
      _open('openFullScreenIntentSettings');

  static Future<bool> _open(String method) async {
    try {
      return await _channel.invokeMethod<bool>(method) ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }
}
