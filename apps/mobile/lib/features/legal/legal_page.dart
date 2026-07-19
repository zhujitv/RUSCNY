import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/localization/app_localization.dart';

enum LegalDocument { privacy, terms }

final class LegalPage extends StatelessWidget {
  const LegalPage({required this.document, super.key});

  final LegalDocument document;

  @override
  Widget build(BuildContext context) {
    final suffix =
        Localizations.localeOf(context).languageCode == 'ru' ? 'ru' : 'zh';
    final title = document == LegalDocument.privacy ? '隐私政策' : '用户协议';
    final asset = document == LegalDocument.privacy
        ? 'assets/legal/privacy_$suffix.md'
        : 'assets/legal/terms_$suffix.md';
    return Scaffold(
      appBar: AppBar(title: AppText(title)),
      body: FutureBuilder<String>(
        future: rootBundle.loadString(asset),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final content = snapshot.data!
              .replaceAll(RegExp(r'^#\s+', multiLine: true), '')
              .replaceAll(RegExp(r'^##\s+', multiLine: true), '');
          return SelectionArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: AppText(
                content,
                translate: false,
                style: const TextStyle(fontSize: 16, height: 1.8),
              ),
            ),
          );
        },
      ),
    );
  }
}
