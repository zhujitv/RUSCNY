import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/notifications/push_notification_service.dart';
import '../../core/notifications/push_registration_coordinator.dart';
import '../auth/account_pages.dart';
import '../auth/auth_controller.dart';
import '../glossary/glossary_page.dart';
import '../legal/legal_page.dart';
import 'settings_controller.dart';

final class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsControllerProvider);
    final session = ref.watch(authControllerProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const AppText('设置')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: AccountAvatar(
                    displayName: session?.displayName,
                    preset: session?.avatarPreset ?? 'jade',
                  ),
                  title: AppText(
                    session?.displayName ?? '用户',
                    translate: session?.displayName == null,
                  ),
                  subtitle: AppText(
                    session?.email ?? _roleLabel(session?.role.name),
                    translate: session?.email == null,
                  ),
                  trailing: session?.role == UserRole.guest
                      ? null
                      : const Icon(Icons.edit_outlined),
                  onTap: session?.role == UserRole.guest
                      ? null
                      : () => Navigator.push<void>(
                            context,
                            MaterialPageRoute<void>(
                              builder: (_) => const ProfilePage(),
                            ),
                          ),
                ),
                if (session?.role != UserRole.guest) ...[
                  const Divider(height: 1),
                  ListTile(
                    leading: const Icon(Icons.lock_outline),
                    title: const AppText('修改密码'),
                    subtitle: const AppText('更新密码并让其他设备安全下线'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.push<void>(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => const ChangePasswordPage(),
                      ),
                    ),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: const Icon(Icons.devices_outlined),
                    title: const AppText('登录设备'),
                    subtitle: const AppText('查看设备并远程下线'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.push<void>(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => const DevicesPage(),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          AppText('应用语言', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          Card(
            child: ListTile(
              leading: const Icon(Icons.language_outlined),
              title: const AppText('语言'),
              subtitle: const AppText('默认跟随手机系统语言'),
              trailing: DropdownButton<AppLanguageMode>(
                value: settings.valueOrNull?.languageMode ??
                    AppLanguageMode.system,
                underline: const SizedBox.shrink(),
                items: const [
                  DropdownMenuItem(
                    value: AppLanguageMode.system,
                    child: AppText('跟随系统'),
                  ),
                  DropdownMenuItem(
                    value: AppLanguageMode.zh,
                    child: AppText('中文', translate: false),
                  ),
                  DropdownMenuItem(
                    value: AppLanguageMode.ru,
                    child: AppText('Русский', translate: false),
                  ),
                ],
                onChanged: (value) {
                  if (value != null) {
                    _savePreference(
                      context,
                      () => ref
                          .read(settingsControllerProvider.notifier)
                          .setLanguageMode(value),
                    );
                  }
                },
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (session != null && session.role != UserRole.guest) ...[
            AppText('来电提醒', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 6),
            const _IncomingCallSettingsCard(),
            const SizedBox(height: 12),
          ],
          AppText('语音播放', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          Card(
            child: Column(
              children: [
                SwitchListTile(
                  title: const AppText('自动播放最终译文'),
                  subtitle: const AppText('临时识别内容不会播放'),
                  value: settings.valueOrNull?.autoPlay ?? true,
                  onChanged: (value) => _savePreference(
                    context,
                    () => ref
                        .read(settingsControllerProvider.notifier)
                        .setAutoPlay(value),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  title: const AppText('播放速度'),
                  trailing: DropdownButton<double>(
                    value: settings.valueOrNull?.playbackSpeed ?? 1,
                    items: const [.75, 1.0, 1.25, 1.5]
                        .map(
                          (speed) => DropdownMenuItem(
                            value: speed,
                            child: AppText('${speed}x'),
                          ),
                        )
                        .toList(growable: false),
                    onChanged: (value) {
                      if (value != null) {
                        _savePreference(
                          context,
                          () => ref
                              .read(settingsControllerProvider.notifier)
                              .setPlaybackSpeed(value),
                        );
                      }
                    },
                  ),
                ),
                const ListTile(
                  leading: Icon(Icons.volume_up_outlined),
                  title: AppText('听不到声音？'),
                  subtitle: AppText('请提高媒体音量；iPhone 请同时检查静音模式和音频输出设备。'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (session != null && session.role != UserRole.guest) ...[
            AppText('翻译词库', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 6),
            Card(
              child: ListTile(
                leading: const Icon(Icons.spellcheck),
                title: const AppText('专业术语'),
                subtitle: const AppText('新增、编辑或停用地板外贸热词'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push<void>(
                  context,
                  MaterialPageRoute<void>(builder: (_) => const GlossaryPage()),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          AppText('隐私与账号', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: const AppText('隐私政策'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push<void>(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          const LegalPage(document: LegalDocument.privacy),
                    ),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: const AppText('用户协议'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push<void>(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          const LegalPage(document: LegalDocument.terms),
                    ),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.logout),
                  title: const AppText('退出登录'),
                  onTap: () => _logout(context, ref),
                ),
                if (session != null) ...[
                  const Divider(height: 1),
                  ListTile(
                    leading: Icon(
                      Icons.delete_forever_outlined,
                      color: Theme.of(context).colorScheme.error,
                    ),
                    title: AppText(
                      session.role == UserRole.guest ? '删除访客身份' : '注销账号',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                    subtitle: AppText(
                      session.role == UserRole.guest
                          ? '删除当前临时访客身份并立即退出会议'
                          : '将向服务端申请删除账号和依法可删除的数据',
                    ),
                    onTap: () => _deleteAccount(context, ref, session.role),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          const AppText(
            '版本 0.1.16 · 翻译结果仅供沟通辅助，高风险事项请人工复核。',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.black54, fontSize: 12),
          ),
        ],
      ),
    );
  }

  static String _roleLabel(String? role) => switch (role) {
        'host' => '主持人',
        'guest' => '临时访客',
        _ => '客户',
      };

  Future<void> _savePreference(
    BuildContext context,
    Future<void> Function() save,
  ) async {
    try {
      await save();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: AppText(readableError(error))),
        );
      }
    }
  }

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const AppText('退出登录？'),
        content: const AppText('本机令牌和会议缓存将被清除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const AppText('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const AppText('退出'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(authControllerProvider.notifier).logout();
      if (context.mounted) {
        Navigator.popUntil(context, (route) => route.isFirst);
      }
    }
  }

  Future<void> _deleteAccount(
    BuildContext context,
    WidgetRef ref,
    UserRole role,
  ) async {
    final guest = role == UserRole.guest;
    final confirmationText = (guest ? '删除访客身份' : '注销账号').tr(context);
    final russian = Localizations.localeOf(context).languageCode == 'ru';
    final confirmationMessage = guest
        ? russian
            ? 'После удаления вы немедленно выйдете из сессии, а гостевой '
                'профиль нельзя будет восстановить. Введите '
                '«$confirmationText» для подтверждения.'
            : '删除后会立即退出当前会议，该临时身份无法恢复。'
                '请输入“$confirmationText”确认。'
        : russian
            ? 'Удаление аккаунта может быть необратимым. Введите '
                '«$confirmationText» для подтверждения.'
            : '账号注销可能无法撤销。请输入“$confirmationText”确认。';
    final input = TextEditingController();
    final password = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: AppText(confirmationText),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppText(confirmationMessage, translate: false),
            const SizedBox(height: 12),
            TextField(controller: input, autofocus: true),
            if (!guest) ...[
              const SizedBox(height: 12),
              TextField(
                controller: password,
                obscureText: true,
                decoration: InputDecoration(
                  labelText: russian ? '密码 / Пароль' : '密码',
                ),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const AppText('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(
              context,
              input.text.trim() == confirmationText &&
                  (guest || password.text.isNotEmpty),
            ),
            child: AppText(guest ? '确认删除' : '确认注销'),
          ),
        ],
      ),
    );
    final submittedPassword = password.text;
    input.dispose();
    password.dispose();
    if (confirmed != true) return;
    try {
      final success = await ref
          .read(authControllerProvider.notifier)
          .deleteAccount(password: guest ? null : submittedPassword);
      if (context.mounted && success) {
        Navigator.popUntil(context, (route) => route.isFirst);
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: AppText(readableError(error))));
      }
    }
  }
}

final class _IncomingCallSettingsCard extends ConsumerStatefulWidget {
  const _IncomingCallSettingsCard();

  @override
  ConsumerState<_IncomingCallSettingsCard> createState() =>
      _IncomingCallSettingsCardState();
}

final class _IncomingCallSettingsCardState
    extends ConsumerState<_IncomingCallSettingsCard>
    with WidgetsBindingObserver {
  PushNotificationStatus? _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    final status = await PushNotificationService.status();
    if (mounted) setState(() => _status = status);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final registration = ref.watch(pushRegistrationStateProvider);
    final status = _status;
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.phone_in_talk_outlined),
            title: const AppText('后台来电推送'),
            subtitle: AppText(
              _registrationLabel(status, registration),
            ),
            trailing:
                status == null || registration == PushRegistrationState.checking
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        registration == PushRegistrationState.ready
                            ? Icons.check_circle_outline
                            : Icons.error_outline,
                      ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.notifications_active_outlined),
            title: const AppText('允许来电通知'),
            subtitle: AppText(
              status?.notificationsEnabled == true ? '已允许' : '需要开启',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: _openNotificationPermission,
          ),
          if (status?.sdkInt != null && status!.sdkInt >= 26) ...[
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.tune_outlined),
              title: const AppText('来电铃声与横幅'),
              subtitle: AppText(
                status.channelEnabled ? '通知通道已开启' : '通知通道已关闭',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                await PushNotificationService.openIncomingCallChannelSettings();
              },
            ),
          ],
          if (status?.fullScreenPermissionRequired == true) ...[
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.fullscreen_outlined),
              title: const AppText('锁屏全屏提醒'),
              subtitle: AppText(
                status!.fullScreenAllowed ? '已允许' : '需要开启',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                await PushNotificationService.openFullScreenIntentSettings();
              },
            ),
          ],
        ],
      ),
    );
  }

  String _registrationLabel(
    PushNotificationStatus? status,
    PushRegistrationState registration,
  ) {
    if (status == null || registration == PushRegistrationState.checking) {
      return '正在检查后台来电服务…';
    }
    if (!status.configured) return '当前安装包尚未配置系统推送';
    return switch (registration) {
      PushRegistrationState.ready => '系统推送已连接',
      PushRegistrationState.serverDisabled => '服务器尚未启用系统推送',
      PushRegistrationState.failed => '连接服务器失败，将自动重试',
      PushRegistrationState.unavailable => '暂时无法取得系统推送标识',
      PushRegistrationState.checking => '正在检查后台来电服务…',
    };
  }

  Future<void> _openNotificationPermission() async {
    final result = await Permission.notification.request();
    if (!result.isGranted) {
      await PushNotificationService.openNotificationSettings();
    }
    await _load();
  }
}
