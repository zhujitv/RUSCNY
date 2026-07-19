import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import '../room/room_page.dart';

final class JoinPage extends ConsumerStatefulWidget {
  const JoinPage({super.key, this.initialInviteToken});

  final String? initialInviteToken;

  @override
  ConsumerState<JoinPage> createState() => _JoinPageState();
}

final class _JoinPageState extends ConsumerState<JoinPage> {
  final _code = TextEditingController();
  final _displayName = TextEditingController();
  final _company = TextEditingController();
  Language _preferredLanguage = Language.ru;
  String? _inviteToken;
  bool _consent = false;
  bool _joining = false;

  @override
  void initState() {
    super.initState();
    _inviteToken = widget.initialInviteToken;
    final session = ref.read(authControllerProvider).valueOrNull;
    _displayName.text = session?.displayName ?? '';
    _company.text = session?.company ?? '';
    _preferredLanguage = session?.preferredLanguage ?? Language.ru;
  }

  @override
  void dispose() {
    _code.dispose();
    _displayName.dispose();
    _company.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const AppText('加入会议')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_inviteToken != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.link),
                  title: const AppText('已读取邀请链接'),
                  subtitle: AppText(
                    '${_inviteToken!.substring(0, _inviteToken!.length < 8 ? _inviteToken!.length : 8)}…',
                    translate: false,
                  ),
                  trailing: IconButton(
                    onPressed: () => setState(() => _inviteToken = null),
                    icon: const Icon(Icons.close),
                  ),
                ),
              )
            else ...[
              FilledButton.tonalIcon(
                onPressed: _scan,
                icon: const Icon(Icons.qr_code_scanner),
                label: const AppText('扫描邀请二维码'),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 18),
                child: Row(
                  children: [
                    Expanded(child: Divider()),
                    Padding(
                        padding: EdgeInsets.symmetric(horizontal: 12),
                        child: AppText('或')),
                    Expanded(child: Divider())
                  ],
                ),
              ),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 22, letterSpacing: 5),
                decoration: InputDecoration(
                  labelText: '输入 6 或 8 位房间码'.tr(context),
                ),
              ),
            ],
            const SizedBox(height: 16),
            AppText(
              '本次会议参会信息',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _displayName,
              decoration: InputDecoration(labelText: '显示名称 *'.tr(context)),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _company,
              decoration: InputDecoration(labelText: '所属公司 *'.tr(context)),
            ),
            const SizedBox(height: 10),
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
            const SizedBox(height: 16),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: (value) => setState(() => _consent = value ?? false),
              title: const AppText('我已知悉本次交流将进行语音识别、翻译并保存文字记录。'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: !_consent || _joining ? null : _join,
              child: AppText(_joining ? '验证权限中…' : '加入会议'),
            ),
          ],
        ),
      );

  Future<void> _scan() async {
    final raw = await Navigator.push<String>(
      context,
      MaterialPageRoute<String>(builder: (_) => const ScannerPage()),
    );
    if (raw == null || !mounted) return;
    final uri = Uri.tryParse(raw);
    final token =
        uri == null ? null : ref.read(deepLinkServiceProvider).inviteToken(uri);
    if (token != null) {
      setState(() => _inviteToken = token);
    } else if (RegExp(r'^\d{6,8}$').hasMatch(raw.trim())) {
      _code.text = raw.trim();
    } else {
      _snack('二维码不是有效会议邀请');
    }
  }

  Future<void> _join() async {
    final code = _code.text.trim();
    if (_inviteToken == null && !RegExp(r'^\d{6,8}$').hasMatch(code)) {
      _snack('请输入有效房间码');
      return;
    }
    if (_displayName.text.trim().isEmpty || _company.text.trim().isEmpty) {
      _snack('请输入显示名称和所属公司');
      return;
    }
    setState(() => _joining = true);
    try {
      final repository = ref.read(conversationRepositoryProvider);
      final database = ref.read(localDatabaseProvider);
      final conversation = await repository.join(
        roomToken: _inviteToken,
        roomCode: _inviteToken == null ? code : null,
        displayName: _displayName.text,
        company: _company.text,
        preferredLanguage: _preferredLanguage,
      );
      try {
        await database.cacheConversation(conversation);
      } catch (_) {
        // Joining is a server-side membership change. Do not report a false
        // failure or invite a duplicate join because the optional cache failed.
      }
      ref.read(pendingInviteProvider.notifier).state = null;
      if (!mounted) return;
      await Navigator.pushReplacement<void, void>(
        context,
        MaterialPageRoute<void>(
            builder: (_) => RoomPage(conversationId: conversation.id)),
      );
    } catch (error) {
      _snack(readableError(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: AppText(message)));
  }
}

final class ScannerPage extends StatefulWidget {
  const ScannerPage({super.key});

  @override
  State<ScannerPage> createState() => _ScannerPageState();
}

final class _ScannerPageState extends State<ScannerPage> {
  final _controller =
      MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const AppText('扫描二维码')),
        body: Stack(
          fit: StackFit.expand,
          children: [
            MobileScanner(
              controller: _controller,
              onDetect: (capture) {
                if (_handled) return;
                final value = capture.barcodes.isEmpty
                    ? null
                    : capture.barcodes.first.rawValue;
                if (value == null) return;
                _handled = true;
                _controller.stop();
                Navigator.pop(context, value);
              },
            ),
            Center(
              child: IgnorePointer(
                child: Container(
                  width: 250,
                  height: 250,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.white, width: 3),
                    borderRadius: BorderRadius.circular(24),
                  ),
                ),
              ),
            ),
          ],
        ),
      );
}
