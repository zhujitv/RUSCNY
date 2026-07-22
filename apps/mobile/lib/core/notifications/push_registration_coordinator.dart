import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../providers.dart';
import 'push_notification_service.dart';

enum PushRegistrationState {
  checking,
  ready,
  unavailable,
  serverDisabled,
  failed,
}

const pushRegistrationRetryInterval = Duration(seconds: 30);
const pushRegistrationServerRefreshInterval = Duration(minutes: 5);

final pushRegistrationStateProvider = StateProvider<PushRegistrationState>(
  (_) => PushRegistrationState.checking,
);

/// Keeps the install-scoped FCM registration bound to the authenticated device
/// session. Failures never block login and are retried on a bounded timer.
final class PushRegistrationCoordinator extends ConsumerStatefulWidget {
  const PushRegistrationCoordinator({
    required this.session,
    required this.child,
    super.key,
  });

  final AuthSession session;
  final Widget child;

  @override
  ConsumerState<PushRegistrationCoordinator> createState() =>
      _PushRegistrationCoordinatorState();
}

final class _PushRegistrationCoordinatorState
    extends ConsumerState<PushRegistrationCoordinator>
    with WidgetsBindingObserver {
  bool _syncing = false;
  bool _syncAgain = false;
  int _bindingGeneration = 0;
  String? _lastSyncedRegistrationKey;
  bool? _lastDeliveryEnabled;
  bool _serverRefreshDue = true;
  bool _inForeground = true;
  Timer? _retryTimer;
  Timer? _serverRefreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    PushNotificationService.listenForRegistrationChanges(_requestSync);
    WidgetsBinding.instance.addPostFrameCallback((_) => _requestSync());
  }

  @override
  void didUpdateWidget(PushRegistrationCoordinator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session.userId != widget.session.userId) {
      _bindingGeneration++;
      _cancelScheduledSyncs();
      _resetRegistrationCache();
      unawaited(_resetBindingAndSync());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _inForeground = state == AppLifecycleState.resumed;
    if (_inForeground) unawaited(_requestSync());
  }

  Future<void> _requestSync() async {
    if (!mounted) return;
    if (widget.session.role == UserRole.guest) {
      _cancelScheduledSyncs();
      _resetRegistrationCache();
      await PushNotificationService.clearBinding();
      ref.read(pushRegistrationStateProvider.notifier).state =
          PushRegistrationState.unavailable;
      return;
    }
    if (_syncing) {
      _syncAgain = true;
      return;
    }
    _syncing = true;
    try {
      do {
        _syncAgain = false;
        await _syncOnce();
      } while (_syncAgain && mounted);
    } finally {
      _syncing = false;
    }
  }

  Future<void> _syncOnce() async {
    final generation = _bindingGeneration;
    final subjectId = widget.session.userId;
    ref.read(pushRegistrationStateProvider.notifier).state =
        PushRegistrationState.checking;
    final registration = await PushNotificationService.registration(
      subjectId,
    );
    if (!_isCurrent(generation)) return;
    if (registration == null) {
      await PushNotificationService.setIncomingCallsEnabled(false);
      if (!_isCurrent(generation)) return;
      _lastSyncedRegistrationKey = null;
      _lastDeliveryEnabled = null;
      _serverRefreshDue = true;
      _serverRefreshTimer?.cancel();
      _serverRefreshTimer = null;
      ref.read(pushRegistrationStateProvider.notifier).state =
          PushRegistrationState.unavailable;
      _scheduleRetry();
      return;
    }
    if (registration.syncKey == _lastSyncedRegistrationKey &&
        !_serverRefreshDue &&
        _lastDeliveryEnabled != null) {
      ref.read(pushRegistrationStateProvider.notifier).state =
          _lastDeliveryEnabled!
              ? PushRegistrationState.ready
              : PushRegistrationState.serverDisabled;
      return;
    }
    try {
      final deliveryEnabled =
          await ref.read(authRepositoryProvider).registerPushNotification(
                registration.registrationId,
                bindingId: registration.bindingId,
              );
      if (!_isCurrent(generation)) return;
      if (!deliveryEnabled) {
        // The native bridge also removes every currently displayed incoming
        // notification when it disables delivery.
        await PushNotificationService.setIncomingCallsEnabled(false);
        if (!_isCurrent(generation)) return;
        _recordServerConfirmation(
          registration.syncKey,
          deliveryEnabled: false,
        );
        ref.read(pushRegistrationStateProvider.notifier).state =
            PushRegistrationState.serverDisabled;
        return;
      }
      await PushNotificationService.setIncomingCallsEnabled(true);
      if (!_isCurrent(generation)) return;
      _recordServerConfirmation(
        registration.syncKey,
        deliveryEnabled: true,
      );
      ref.read(pushRegistrationStateProvider.notifier).state =
          PushRegistrationState.ready;
    } catch (_) {
      if (!_isCurrent(generation)) return;
      _serverRefreshDue = true;
      ref.read(pushRegistrationStateProvider.notifier).state =
          PushRegistrationState.failed;
      _scheduleRetry();
    }
  }

  bool _isCurrent(int generation) =>
      mounted && generation == _bindingGeneration;

  void _scheduleRetry() {
    _retryTimer ??= Timer(pushRegistrationRetryInterval, () {
      _retryTimer = null;
      _serverRefreshDue = true;
      unawaited(_requestSync());
    });
  }

  void _recordServerConfirmation(
    String registrationKey, {
    required bool deliveryEnabled,
  }) {
    _lastSyncedRegistrationKey = registrationKey;
    _lastDeliveryEnabled = deliveryEnabled;
    _serverRefreshDue = false;
    _retryTimer?.cancel();
    _retryTimer = null;
    _serverRefreshTimer?.cancel();
    _serverRefreshTimer = Timer(pushRegistrationServerRefreshInterval, () {
      _serverRefreshTimer = null;
      _serverRefreshDue = true;
      if (mounted && _inForeground) unawaited(_requestSync());
    });
  }

  void _resetRegistrationCache() {
    _lastSyncedRegistrationKey = null;
    _lastDeliveryEnabled = null;
    _serverRefreshDue = true;
  }

  void _cancelScheduledSyncs() {
    _retryTimer?.cancel();
    _retryTimer = null;
    _serverRefreshTimer?.cancel();
    _serverRefreshTimer = null;
  }

  Future<void> _resetBindingAndSync() async {
    await PushNotificationService.clearBinding();
    if (mounted) await _requestSync();
  }

  @override
  void dispose() {
    _cancelScheduledSyncs();
    PushNotificationService.stopListeningForRegistrationChanges();
    unawaited(PushNotificationService.clearBinding());
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
