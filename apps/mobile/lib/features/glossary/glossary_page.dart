import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/localization/app_localization.dart';
import '../../core/providers.dart';
import '../../shared/async_view.dart';
import 'glossary_repository.dart';

final class GlossaryPage extends ConsumerStatefulWidget {
  const GlossaryPage({super.key});

  @override
  ConsumerState<GlossaryPage> createState() => _GlossaryPageState();
}

final class _GlossaryPageState extends ConsumerState<GlossaryPage> {
  late Future<List<GlossaryTerm>> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(glossaryRepositoryProvider).list();
  }

  void _reload() {
    setState(() => _future = ref.read(glossaryRepositoryProvider).list());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const AppText('专业术语')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _edit(),
          icon: const Icon(Icons.add),
          label: const AppText('新增术语'),
        ),
        body: FutureBuilder<List<GlossaryTerm>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const LoadingView();
            }
            if (snapshot.hasError) {
              return ErrorView(error: snapshot.error!, onRetry: _reload);
            }
            final terms = snapshot.data ?? const [];
            if (terms.isEmpty) return const Center(child: AppText('还没有术语'));
            return RefreshIndicator(
              onRefresh: () async => _reload(),
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 96),
                itemCount: terms.length,
                separatorBuilder: (_, __) => const SizedBox(height: 7),
                itemBuilder: (context, index) {
                  final term = terms[index];
                  return Card(
                    child: ListTile(
                      title: AppText(
                        '${term.sourceTerm} → ${term.targetTerm}',
                        translate: false,
                      ),
                      subtitle: AppText(
                        '${term.sourceLanguage.toUpperCase()} → '
                        '${term.targetLanguage.toUpperCase()}'
                        '${term.category == null ? '' : ' · ${term.category}'}',
                        translate: false,
                      ),
                      onTap: () => _edit(term),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Switch(
                            value: term.enabled,
                            onChanged: (enabled) => _toggle(term, enabled),
                          ),
                          PopupMenuButton<String>(
                            onSelected: (value) {
                              if (value == 'delete') _delete(term);
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(
                                  value: 'delete', child: AppText('删除')),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            );
          },
        ),
      );

  Future<void> _toggle(GlossaryTerm term, bool enabled) async {
    try {
      await ref
          .read(glossaryRepositoryProvider)
          .update(term.id, enabled: enabled);
      _reload();
    } catch (error) {
      _snack(readableError(error));
    }
  }

  Future<void> _edit([GlossaryTerm? term]) async {
    final source = TextEditingController(text: term?.sourceTerm);
    final target = TextEditingController(text: term?.targetTerm);
    final category = TextEditingController(text: term?.category);
    var sourceLanguage = term?.sourceLanguage ?? 'en';
    var targetLanguage = term?.targetLanguage ?? 'ru';
    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: AppText(term == null ? '新增术语' : '编辑术语'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: sourceLanguage,
                        decoration: InputDecoration(
                          labelText: '原语言'.tr(context),
                        ),
                        items: const ['zh', 'ru', 'en']
                            .map(
                              (value) => DropdownMenuItem(
                                value: value,
                                child: AppText(
                                  value.toUpperCase(),
                                  translate: false,
                                ),
                              ),
                            )
                            .toList(growable: false),
                        onChanged: (value) => setDialogState(
                          () => sourceLanguage = value ?? 'en',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: targetLanguage,
                        decoration: InputDecoration(
                          labelText: '目标语言'.tr(context),
                        ),
                        items: const ['zh', 'ru']
                            .map(
                              (value) => DropdownMenuItem(
                                value: value,
                                child: AppText(
                                  value.toUpperCase(),
                                  translate: false,
                                ),
                              ),
                            )
                            .toList(growable: false),
                        onChanged: (value) => setDialogState(
                          () => targetLanguage = value ?? 'ru',
                        ),
                      ),
                    ),
                  ],
                ),
                if (sourceLanguage == 'en') ...[
                  const SizedBox(height: 8),
                  const AppText(
                    'EN 适合品牌、型号和国际通用词；目标语言可分别选择中文或俄语。',
                    style: TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                ],
                const SizedBox(height: 10),
                TextField(
                  controller: source,
                  decoration: InputDecoration(labelText: '原词 *'.tr(context)),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: target,
                  decoration: InputDecoration(labelText: '目标词 *'.tr(context)),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: category,
                  decoration: InputDecoration(labelText: '分类'.tr(context)),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const AppText('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(
                context,
                source.text.trim().isNotEmpty && target.text.trim().isNotEmpty,
              ),
              child: const AppText('保存'),
            ),
          ],
        ),
      ),
    );
    if (submitted == true) {
      try {
        final repository = ref.read(glossaryRepositoryProvider);
        if (term == null) {
          await repository.create(
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
            sourceTerm: source.text,
            targetTerm: target.text,
            category: category.text,
          );
        } else {
          await repository.update(
            term.id,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
            sourceTerm: source.text,
            targetTerm: target.text,
            category: category.text,
          );
        }
        _reload();
      } catch (error) {
        _snack(readableError(error));
      }
    }
    source.dispose();
    target.dispose();
    category.dispose();
  }

  Future<void> _delete(GlossaryTerm term) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const AppText('删除术语？'),
        content: AppText(
          '${term.sourceTerm} → ${term.targetTerm}',
          translate: false,
        ),
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
      await ref.read(glossaryRepositoryProvider).delete(term.id);
      _reload();
    } catch (error) {
      _snack(readableError(error));
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
