import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/auth/auth_repository.dart';
import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../shared/async_view.dart';
import 'auth_controller.dart';

final class ProfilePage extends ConsumerStatefulWidget {
  const ProfilePage({super.key});

  @override
  ConsumerState<ProfilePage> createState() => _ProfilePageState();
}

final class _ProfilePageState extends ConsumerState<ProfilePage> {
  late final TextEditingController _name;
  final _phone = TextEditingController();
  final _company = TextEditingController();
  Language _preferredLanguage = Language.zh;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final session = ref.read(authControllerProvider).valueOrNull;
    _name = TextEditingController(text: session?.displayName);
    _phone.text = session?.phone ?? '';
    _company.text = session?.company ?? '';
    _preferredLanguage = session?.preferredLanguage ?? Language.zh;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _company.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const AppText('编辑个人资料')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextField(
              controller: _name,
              decoration: InputDecoration(labelText: '姓名或显示名称 *'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(labelText: '手机号（可选）'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _company,
              decoration: InputDecoration(labelText: '所属公司'.tr(context)),
            ),
            const SizedBox(height: 12),
            SegmentedButton<Language>(
              segments: const [
                ButtonSegment(value: Language.zh, label: AppText('中文')),
                ButtonSegment(value: Language.ru, label: AppText('Русский')),
              ],
              selected: {_preferredLanguage},
              onSelectionChanged: (value) {
                setState(() => _preferredLanguage = value.first);
              },
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: AppText(_saving ? '保存中…' : '保存资料'),
            ),
          ],
        ),
      );

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      _snack('请输入显示名称');
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(authControllerProvider.notifier).updateProfile(
            displayName: _name.text,
            phone: _phone.text,
            company: _company.text,
            preferredLanguage: _preferredLanguage,
          );
      if (mounted) Navigator.pop(context);
    } catch (error) {
      _snack(readableError(error));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _snack(String message) {
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: AppText(message)));
    }
  }
}

final class DevicesPage extends ConsumerStatefulWidget {
  const DevicesPage({super.key});

  @override
  ConsumerState<DevicesPage> createState() => _DevicesPageState();
}

final class _DevicesPageState extends ConsumerState<DevicesPage> {
  late Future<List<LoginDevice>> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(authRepositoryProvider).devices();
  }

  void _reload() {
    setState(() => _future = ref.read(authRepositoryProvider).devices());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const AppText('登录设备')),
        body: FutureBuilder<List<LoginDevice>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const LoadingView();
            }
            if (snapshot.hasError) {
              return ErrorView(error: snapshot.error!, onRetry: _reload);
            }
            final devices = snapshot.data ?? const [];
            if (devices.isEmpty) return const Center(child: AppText('没有登录设备'));
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: devices.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final device = devices[index];
                return Card(
                  child: ListTile(
                    leading: Icon(_deviceIcon(device.platform)),
                    title: AppText(
                      device.current
                          ? '${device.platform ?? '本机'}（当前设备）'
                          : device.revoked
                              ? '${device.platform ?? '移动设备'}（已下线）'
                              : device.platform ?? '移动设备',
                    ),
                    subtitle: AppText(
                      '最近使用：${DateFormat('yyyy-MM-dd HH:mm').format(device.lastSeenAt)}\n'
                      '设备：${_shortId(device.deviceId)}'
                      '${device.revokedAt == null ? '' : ' · ${DateFormat('yyyy-MM-dd HH:mm').format(device.revokedAt!)} 下线'}',
                    ),
                    isThreeLine: true,
                    trailing: device.current || device.revoked
                        ? device.revoked
                            ? const AppText('已撤销')
                            : null
                        : TextButton(
                            onPressed: () => _revoke(device),
                            child: const AppText('远程下线'),
                          ),
                  ),
                );
              },
            );
          },
        ),
      );

  Future<void> _revoke(LoginDevice device) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const AppText('让该设备下线？'),
        content: const AppText('该设备的刷新凭证会被吊销，下次请求或重连时需要重新登录。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const AppText('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const AppText('远程下线'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(authRepositoryProvider).revokeDevice(device.deviceId);
      _reload();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: AppText(readableError(error))));
      }
    }
  }

  static String _shortId(String value) {
    if (value.length <= 12) return value;
    return '${value.substring(0, 6)}…${value.substring(value.length - 4)}';
  }

  static IconData _deviceIcon(String? platform) =>
      switch (platform?.toUpperCase()) {
        'IOS' => Icons.phone_iphone,
        'ANDROID' => Icons.phone_android,
        _ => Icons.smartphone,
      };
}
