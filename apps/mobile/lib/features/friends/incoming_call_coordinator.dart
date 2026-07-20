import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/audio/audio_cue_service.dart';
import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import 'friend_call_page.dart';
import 'social_realtime_controller.dart';

final class IncomingFriendCallCoordinator extends ConsumerStatefulWidget {
  const IncomingFriendCallCoordinator({
    required this.session,
    required this.child,
    super.key,
  });

  final AuthSession session;
  final Widget child;

  @override
  ConsumerState<IncomingFriendCallCoordinator> createState() =>
      _IncomingFriendCallCoordinatorState();
}

final class _IncomingFriendCallCoordinatorState
    extends ConsumerState<IncomingFriendCallCoordinator>
    with WidgetsBindingObserver {
  Timer? _recoveryTimer;
  String? _handledCallId;
  String? _scheduledCallId;
  bool _dialogOpen = false;
  bool _recovering = false;
  bool _inForeground = true;
  String? _notifiedCallId;
  ({String action, String callId})? _pendingNativeAction;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(Permission.notification.request());
        unawaited(_recoverIncomingCall(includeActive: true));
      }
    });
    _recoveryTimer = Timer.periodic(const Duration(seconds: 8), (_) {
      if (mounted && _inForeground) {
        unawaited(_recoverIncomingCall(includeActive: false));
      }
    });
  }

  @override
  void didUpdateWidget(IncomingFriendCallCoordinator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session.userId != widget.session.userId) {
      _handledCallId = null;
      _scheduledCallId = null;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _inForeground = state == AppLifecycleState.resumed;
    if (_inForeground) {
      unawaited(_recoverIncomingCall(includeActive: true));
    }
  }

  @override
  void dispose() {
    _recoveryTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final incomingCall = ref.watch(
      socialRealtimeProvider.select((state) => state.latestCall),
    );
    if (incomingCall != null &&
        incomingCall.direction == 'INCOMING' &&
        incomingCall.isRinging) {
      _scheduleIncomingCall(incomingCall);
    }
    return widget.child;
  }

  void _scheduleIncomingCall(FriendCallModel call) {
    if (_dialogOpen ||
        call.id == _handledCallId ||
        call.id == _scheduledCallId) {
      return;
    }
    if (!_inForeground) {
      if (_notifiedCallId != call.id) {
        _notifiedCallId = call.id;
        unawaited(
          AudioCueService.showIncomingCallNotification(
            callId: call.id,
            callerName: call.peer.displayName,
            title: AppLocalization.translate(context, '好友语音来电'),
            answerLabel: AppLocalization.translate(context, '接听'),
            declineLabel: AppLocalization.translate(context, '拒绝'),
          ),
        );
      }
      return;
    }
    _scheduledCallId = call.id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _scheduledCallId = null;
      unawaited(_presentIncomingCall(call));
    });
  }

  Future<void> _recoverIncomingCall({required bool includeActive}) async {
    if (_recovering || _dialogOpen || widget.session.role == UserRole.guest) {
      return;
    }
    _recovering = true;
    try {
      _pendingNativeAction ??=
          await AudioCueService.consumeIncomingCallAction();
      final pendingAction = _pendingNativeAction;
      final call = await ref.read(friendRepositoryProvider).activeCall();
      if (!mounted || call == null || call.id == _handledCallId) return;
      if (pendingAction?.callId == call.id &&
          call.direction == 'INCOMING' &&
          call.isRinging &&
          pendingAction?.action != 'show') {
        await AudioCueService.cancelIncomingCallNotification(call.id);
        _notifiedCallId = null;
        final accepted = pendingAction?.action == 'answer';
        _pendingNativeAction = null;
        final updated = await ref
            .read(friendRepositoryProvider)
            .respondToCall(call.id, accept: accepted);
        _handledCallId = call.id;
        if (accepted && mounted) {
          await Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => FriendCallPage(initialCall: updated),
            ),
          );
        }
        return;
      }
      if (call.direction == 'INCOMING' && call.isRinging) {
        if (pendingAction?.callId == call.id &&
            pendingAction?.action == 'show') {
          _pendingNativeAction = null;
        }
        _scheduleIncomingCall(call);
      } else if (includeActive &&
          call.isActive &&
          ModalRoute.of(context)?.isCurrent == true) {
        _handledCallId = call.id;
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => FriendCallPage(initialCall: call),
          ),
        );
      }
    } catch (_) {
      // Socket delivery remains primary; polling retries after transient errors.
    } finally {
      _recovering = false;
    }
  }

  Future<void> _presentIncomingCall(FriendCallModel call) async {
    if (_dialogOpen || call.id == _handledCallId || !mounted) return;
    _dialogOpen = true;
    _handledCallId = call.id;
    ref.read(socialRealtimeProvider.notifier).consumeCall(call.id);
    try {
      await AudioCueService.cancelIncomingCallNotification(call.id);
      _notifiedCallId = null;
      await AudioCueService.startIncomingRingtone();
      if (!mounted) return;
      final accepted = await showDialog<bool>(
        context: context,
        useRootNavigator: true,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const AppText('好友语音来电'),
          content: AppText(call.peer.displayName, translate: false),
          actions: [
            OutlinedButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const AppText('拒绝'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.pop(dialogContext, true),
              icon: const Icon(Icons.call),
              label: const AppText('接听'),
            ),
          ],
        ),
      );
      await AudioCueService.stopIncomingRingtone();
      final updated = await ref
          .read(friendRepositoryProvider)
          .respondToCall(call.id, accept: accepted == true);
      if (accepted == true && mounted) {
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => FriendCallPage(initialCall: updated),
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(content: AppText(readableError(error))),
      );
    } finally {
      await AudioCueService.stopIncomingRingtone();
      _dialogOpen = false;
    }
  }
}
