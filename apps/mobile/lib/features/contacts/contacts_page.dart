import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../shared/async_view.dart';
import '../conversations/create_conversation_page.dart';
import '../history/history_page.dart';

final class ContactsPage extends ConsumerStatefulWidget {
  const ContactsPage({super.key, this.selectionMode = false});

  final bool selectionMode;

  @override
  ConsumerState<ContactsPage> createState() => _ContactsPageState();
}

final class _ContactsPageState extends ConsumerState<ContactsPage> {
  final _search = TextEditingController();
  late Future<List<Contact>> _contacts;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _contacts =
          ref.read(contactRepositoryProvider).list(search: _search.text);
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: AppText(widget.selectionMode ? '选择交流客户' : '客户')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _create,
          icon: const Icon(Icons.person_add_alt_1),
          label: const AppText('新建客户'),
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _reload(),
                decoration: InputDecoration(
                  hintText: '搜索姓名、公司或备注'.tr(context),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    onPressed: _reload,
                    icon: const Icon(Icons.arrow_forward),
                  ),
                ),
              ),
            ),
            Expanded(
              child: FutureBuilder<List<Contact>>(
                future: _contacts,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const LoadingView();
                  }
                  if (snapshot.hasError) {
                    return ErrorView(error: snapshot.error!, onRetry: _reload);
                  }
                  final items = snapshot.data ?? const [];
                  if (items.isEmpty) {
                    return const Center(child: AppText('还没有客户，先新建一位客户'));
                  }
                  return RefreshIndicator(
                    onRefresh: () async => _reload(),
                    child: ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final contact = items[index];
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              child: AppText(
                                contact.displayName.characters.first,
                                translate: false,
                              ),
                            ),
                            title: AppText(
                              contact.displayName,
                              translate: false,
                            ),
                            subtitle: AppText(
                              [contact.company, contact.country]
                                  .whereType<String>()
                                  .where((value) => value.isNotEmpty)
                                  .join(' · '),
                              translate: false,
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () {
                              if (widget.selectionMode) {
                                Navigator.pop(context, contact);
                              } else {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                    builder: (_) =>
                                        ContactDetailPage(contact: contact),
                                  ),
                                ).then((_) => _reload());
                              }
                            },
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      );

  Future<void> _create() async {
    final contact = await Navigator.push<Contact>(
      context,
      MaterialPageRoute<Contact>(builder: (_) => const ContactFormPage()),
    );
    if (!mounted || contact == null) return;
    if (widget.selectionMode) {
      Navigator.pop(context, contact);
    } else {
      _reload();
    }
  }
}

final class ContactFormPage extends ConsumerStatefulWidget {
  const ContactFormPage({super.key, this.contact});

  final Contact? contact;

  @override
  ConsumerState<ContactFormPage> createState() => _ContactFormPageState();
}

final class _ContactFormPageState extends ConsumerState<ContactFormPage> {
  late final TextEditingController _name;
  late final TextEditingController _company;
  late final TextEditingController _country;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _notes;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final contact = widget.contact;
    _name = TextEditingController(text: contact?.displayName);
    _company = TextEditingController(text: contact?.company);
    _country = TextEditingController(text: contact?.country);
    _phone = TextEditingController(text: contact?.phone);
    _email = TextEditingController(text: contact?.email);
    _notes = TextEditingController(text: contact?.notes);
  }

  @override
  void dispose() {
    for (final controller in [
      _name,
      _company,
      _country,
      _phone,
      _email,
      _notes,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar:
            AppBar(title: AppText(widget.contact == null ? '新建客户' : '编辑客户')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextField(
              controller: _name,
              decoration: InputDecoration(labelText: '姓名或显示名称 *'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _company,
              decoration: InputDecoration(labelText: '公司'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _country,
              decoration: InputDecoration(labelText: '国家或地区'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(labelText: '手机号'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(labelText: '邮箱'.tr(context)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              maxLines: 4,
              decoration: InputDecoration(labelText: '备注'.tr(context)),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: AppText(_saving ? '保存中…' : '保存'),
            ),
          ],
        ),
      );

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: AppText('请输入客户名称')));
      return;
    }
    setState(() => _saving = true);
    try {
      final repository = ref.read(contactRepositoryProvider);
      final existing = widget.contact;
      final contact = existing == null
          ? await repository.create(
              displayName: _name.text,
              company: _company.text,
              country: _country.text,
              phone: _phone.text,
              email: _email.text,
              notes: _notes.text,
            )
          : await repository.update(
              existing.id,
              displayName: _name.text,
              company: _company.text,
              country: _country.text,
              phone: _phone.text,
              email: _email.text,
              notes: _notes.text,
            );
      if (mounted) Navigator.pop(context, contact);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: AppText(readableError(error))));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

final class ContactDetailPage extends ConsumerStatefulWidget {
  const ContactDetailPage({required this.contact, super.key});

  final Contact contact;

  @override
  ConsumerState<ContactDetailPage> createState() => _ContactDetailPageState();
}

final class _ContactDetailPageState extends ConsumerState<ContactDetailPage> {
  late Contact _contact;

  @override
  void initState() {
    super.initState();
    _contact = widget.contact;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: AppText(_contact.displayName, translate: false),
          actions: [
            IconButton(
              tooltip: '编辑'.tr(context),
              onPressed: _edit,
              icon: const Icon(Icons.edit_outlined),
            ),
            IconButton(
              tooltip: '删除'.tr(context),
              onPressed: _delete,
              icon: const Icon(Icons.delete_outline),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _DetailRow(label: '公司', value: _contact.company),
                    _DetailRow(label: '国家', value: _contact.country),
                    _DetailRow(label: '电话', value: _contact.phone),
                    _DetailRow(label: '邮箱', value: _contact.email),
                    _DetailRow(label: '备注', value: _contact.notes),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute<void>(
                  builder: (_) =>
                      CreateConversationPage(initialContact: _contact),
                ),
              ),
              icon: const Icon(Icons.add_comment_outlined),
              label: const AppText('为该客户新建交流'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => HistoryPage(contactId: _contact.id),
                ),
              ),
              icon: const Icon(Icons.history),
              label: const AppText('查看该客户历史'),
            ),
          ],
        ),
      );

  Future<void> _edit() async {
    final updated = await Navigator.push<Contact>(
      context,
      MaterialPageRoute<Contact>(
        builder: (_) => ContactFormPage(contact: _contact),
      ),
    );
    if (mounted && updated != null) setState(() => _contact = updated);
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const AppText('删除客户？'),
        content: const AppText('已有会议记录的客户不能删除；请先保留或处理相关会议。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const AppText('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const AppText('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(contactRepositoryProvider).delete(_contact.id);
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: AppText(readableError(error))));
      }
    }
  }
}

final class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, this.value});
  final String label;
  final String? value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 64,
              child:
                  AppText(label, style: const TextStyle(color: Colors.black54)),
            ),
            Expanded(
              child: AppText(
                value?.isNotEmpty == true ? value! : '—',
                translate: false,
              ),
            ),
          ],
        ),
      );
}
