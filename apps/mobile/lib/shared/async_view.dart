import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../core/localization/app_localization.dart';

final class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label = '正在加载…'});

  final String label;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 14),
            AppText(label),
          ],
        ),
      );
}

final class ErrorView extends StatelessWidget {
  const ErrorView({required this.error, required this.onRetry, super.key});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 42),
              const SizedBox(height: 12),
              AppText(readableError(error), textAlign: TextAlign.center),
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onRetry, child: const AppText('重试')),
            ],
          ),
        ),
      );
}
