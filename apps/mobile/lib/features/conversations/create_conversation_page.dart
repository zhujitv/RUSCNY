import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import '../contacts/contacts_page.dart';
import 'invite_page.dart';

final class CreateConversationPage extends ConsumerStatefulWidget {
  const CreateConversationPage({super.key, this.initialContact});

  final Contact? initialContact;

  @override
  ConsumerState<CreateConversationPage> createState() =>
      _CreateConversationPageState();
}

final class _CreateConversationPageState
    extends ConsumerState<CreateConversationPage> {
  final _title = TextEditingController();
  final _hostName = TextEditingController();
  final _hostCompany = TextEditingController();
  Language _hostLanguage = Language.zh;
  Contact? _contact;
  GuestHistoryPolicy _policy = GuestHistoryPolicy.accessFor24Hours;
  bool _creating = false;

  @override
  void initState() {
    super.initState();
    _contact = widget.initialContact;
    final session = ref.read(authControllerProvider).valueOrNull;
    _hostName.text = session?.displayName ?? '';
    _hostCompany.text = session?.company ?? '';
    _hostLanguage = session?.preferredLanguage ?? Language.zh;
  }

  @override
  void dispose() {
    _title.dispose();
    _hostName.dispose();
    _hostCompany.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const AppText('新建交流')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            AppText('1. 选择客户', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Card(
              child: ListTile(
                leading: const Icon(Icons.person_outline),
                title: AppText(
                  _contact?.displayName ?? '选择已有客户或新建客户',
                  translate: _contact == null,
                ),
                subtitle: _contact?.company == null
                    ? null
                    : AppText(_contact!.company!, translate: false),
                trailing: const Icon(Icons.chevron_right),
                onTap: _pickContact,
              ),
            ),
            const SizedBox(height: 20),
            AppText('2. 会议信息', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              controller: _title,
              decoration: InputDecoration(
                labelText: '会议主题'.tr(context),
                hintText: '例如：SPC 产品报价'.tr(context),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<GuestHistoryPolicy>(
              initialValue: _policy,
              decoration: InputDecoration(
                labelText: '客户会后查看权限'.tr(context),
              ),
              items: GuestHistoryPolicy.values
                  .map(
                    (policy) => DropdownMenuItem(
                      value: policy,
                      child: AppText(policy.label),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (value) => setState(
                () => _policy = value ?? GuestHistoryPolicy.accessFor24Hours,
              ),
            ),
            const SizedBox(height: 12),
            const Card(
              child: ListTile(
                leading: Icon(Icons.language),
                title: AppText('中文 ⇄ 俄语'),
                subtitle: AppText('第一版固定语言方向，不自动识别语言'),
              ),
            ),
            const SizedBox(height: 20),
            AppText(
              '3. 主持人参会信息',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _hostName,
              decoration: InputDecoration(labelText: '显示名称 *'.tr(context)),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _hostCompany,
              decoration: InputDecoration(labelText: '所属公司 *'.tr(context)),
            ),
            const SizedBox(height: 10),
            SegmentedButton<Language>(
              segments: const [
                ButtonSegment(value: Language.zh, label: AppText('中文')),
                ButtonSegment(value: Language.ru, label: AppText('Русский')),
              ],
              selected: {_hostLanguage},
              onSelectionChanged: (value) {
                setState(() => _hostLanguage = value.first);
              },
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.secondaryContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const AppText(
                '会议创建后将永久绑定所选客户。若交流对象改变，请结束当前会议并新建会议。',
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _creating ? null : _create,
              child: AppText(_creating ? '创建中…' : '创建会议并生成邀请'),
            ),
          ],
        ),
      );

  Future<void> _pickContact() async {
    final contact = await Navigator.push<Contact>(
      context,
      MaterialPageRoute<Contact>(
        builder: (_) => const ContactsPage(selectionMode: true),
      ),
    );
    if (contact != null) setState(() => _contact = contact);
  }

  Future<void> _create() async {
    if (_contact == null) {
      _snack('请先选择客户');
      return;
    }
    if (_title.text.trim().isEmpty) {
      _snack('请填写会议主题');
      return;
    }
    if (_hostName.text.trim().isEmpty || _hostCompany.text.trim().isEmpty) {
      _snack('请确认主持人的姓名和公司');
      return;
    }
    setState(() => _creating = true);
    try {
      final repository = ref.read(conversationRepositoryProvider);
      final database = ref.read(localDatabaseProvider);
      final conversation = await repository.create(
        contactId: _contact!.id,
        title: _title.text,
        guestHistoryPolicy: _policy,
        hostDisplayName: _hostName.text,
        hostCompany: _hostCompany.text,
        hostLanguage: _hostLanguage,
      );
      try {
        await database.cacheConversation(conversation);
      } catch (_) {
        // The server has already created the meeting and invitation. Continue
        // to that durable result even if the local convenience cache is down.
      }
      if (!mounted) return;
      await Navigator.pushReplacement<void, void>(
        context,
        MaterialPageRoute<void>(
          builder: (_) => InvitePage(conversation: conversation),
        ),
      );
    } catch (error) {
      _snack(readableError(error));
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: AppText(message)));
  }
}
