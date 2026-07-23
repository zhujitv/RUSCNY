import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/audio/audio_capture.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import 'face_to_face_controller.dart';
import 'face_to_face_models.dart';
import 'face_to_face_repository.dart';

final class FaceToFacePage extends ConsumerStatefulWidget {
  const FaceToFacePage({super.key, this.controller});

  final FaceToFaceController? controller;

  @override
  ConsumerState<FaceToFacePage> createState() => _FaceToFacePageState();
}

final class _FaceToFacePageState extends ConsumerState<FaceToFacePage>
    with WidgetsBindingObserver {
  late final FaceToFaceController _controller;
  bool _russianOnTop = true;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final playback = ref.read(audioPlaybackProvider);
    _controller = widget.controller ??
        FaceToFaceController(
          recorder: AudioCapture(),
          translator: FaceToFaceRepository(ref.read(apiClientProvider)),
          playAudio: playback.playPublicNow,
          stopAudio: playback.stop,
        );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        unawaited(_controller.suspend());
        break;
      case AppLifecycleState.resumed:
      case AppLifecycleState.inactive:
        break;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (!_closing) unawaited(_controller.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) unawaited(_closeAndPop());
        },
        child: Scaffold(
          appBar: AppBar(
            title: const AppText('面对面翻译'),
            leading: IconButton(
              tooltip: '退出'.tr(context),
              onPressed: _closing ? null : _closeAndPop,
              icon: const Icon(Icons.close),
            ),
          ),
          body: SafeArea(
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final topLanguage = _russianOnTop ? Language.ru : Language.zh;
                final bottomLanguage = topLanguage.opposite;
                return Column(
                  children: [
                    Expanded(
                      child: RotatedBox(
                        quarterTurns: 2,
                        child: _LanguagePanel(
                          key: ValueKey('face-panel-${topLanguage.code}-top'),
                          language: topLanguage,
                          controller: _controller,
                        ),
                      ),
                    ),
                    _CenterControls(
                      controller: _controller,
                      onSwap: () =>
                          setState(() => _russianOnTop = !_russianOnTop),
                      onClear: _confirmClear,
                      onDiscard: _controller.discardPending,
                    ),
                    Expanded(
                      child: _LanguagePanel(
                        key: ValueKey(
                          'face-panel-${bottomLanguage.code}-bottom',
                        ),
                        language: bottomLanguage,
                        controller: _controller,
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      );

  Future<void> _confirmClear() async {
    if (_controller.turns.isEmpty &&
        _controller.phase == FaceToFacePhase.idle &&
        !_controller.hasPendingRetry) {
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const AppText('清空本次对话？'),
        content: const AppText('当前页面中的原文和译文将被清除，且无法恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const AppText('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const AppText('清空'),
          ),
        ],
      ),
    );
    if (confirmed == true) await _controller.clear();
  }

  Future<void> _closeAndPop() async {
    if (_closing) return;
    _closing = true;
    await _controller.close();
    if (mounted) Navigator.pop(context);
  }
}

final class _LanguagePanel extends StatelessWidget {
  const _LanguagePanel({
    required this.language,
    required this.controller,
    super.key,
  });

  final Language language;
  final FaceToFaceController controller;

  @override
  Widget build(BuildContext context) {
    final active = controller.phase == FaceToFacePhase.recording &&
        controller.activeLanguage == language;
    final turns = controller.turns.reversed.toList(growable: false);
    final colors = Theme.of(context).colorScheme;
    final panelColor = language == Language.zh
        ? colors.primaryContainer
        : colors.secondaryContainer;
    return ColoredBox(
      color: panelColor.withValues(alpha: 0.45),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
        child: Column(
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 17,
                  child: Text(language == Language.zh ? '中' : 'Р'),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    language == Language.zh ? '中文' : 'Русский',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),
                if (active) const Icon(Icons.graphic_eq, color: Colors.red),
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: turns.isEmpty
                  ? Center(
                      child: Text(
                        language == Language.zh
                            ? '按住下方按钮说中文'
                            : 'Удерживайте кнопку и говорите по-русски',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    )
                  : ListView.separated(
                      reverse: true,
                      itemCount: turns.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) => _TurnCard(
                        turn: turns[index],
                        language: language,
                        enabled: controller.canRecord,
                        onReplay: () => controller.replay(turns[index]),
                      ),
                    ),
            ),
            const SizedBox(height: 8),
            FaceToFaceTalkButton(
              key: ValueKey('face-talk-${language.code}'),
              language: language,
              phase: controller.phase,
              activeLanguage: controller.activeLanguage,
              enabled: controller.canRecord,
              onStart: () => controller.beginRecording(language),
              onEnd: controller.finishRecording,
              onCancel: controller.cancelRecording,
            ),
          ],
        ),
      ),
    );
  }
}

final class _TurnCard extends StatelessWidget {
  const _TurnCard({
    required this.turn,
    required this.language,
    required this.enabled,
    required this.onReplay,
  });

  final FaceToFaceTurn turn;
  final Language language;
  final bool enabled;
  final VoidCallback onReplay;

  @override
  Widget build(BuildContext context) {
    final isOriginal = turn.translation.sourceLanguage == language;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isOriginal
                        ? (language == Language.zh ? '原话' : 'Оригинал')
                        : (language == Language.zh ? '翻译' : 'Перевод'),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    turn.textFor(language),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ],
              ),
            ),
            if (turn.hasAudioFor(language))
              IconButton(
                tooltip: language == Language.zh ? '播放中文' : 'Воспроизвести',
                onPressed: enabled ? onReplay : null,
                icon: const Icon(Icons.volume_up_outlined),
              ),
          ],
        ),
      ),
    );
  }
}

final class _CenterControls extends StatelessWidget {
  const _CenterControls({
    required this.controller,
    required this.onSwap,
    required this.onClear,
    required this.onDiscard,
  });

  final FaceToFaceController controller;
  final VoidCallback onSwap;
  final VoidCallback onClear;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) => Material(
        elevation: 2,
        color: Theme.of(context).colorScheme.surface,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            children: [
              IconButton(
                key: const ValueKey('face-swap-sides'),
                tooltip: '交换方向'.tr(context),
                onPressed: controller.canRecord ? onSwap : null,
                icon: const Icon(Icons.swap_vert),
              ),
              Expanded(
                child: Text(
                  _statusText(controller).tr(context),
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              if (controller.phase == FaceToFacePhase.playing)
                IconButton(
                  key: const ValueKey('face-stop-playback'),
                  tooltip: '停止播放'.tr(context),
                  onPressed: controller.stopPlayback,
                  icon: const Icon(Icons.stop_circle_outlined),
                )
              else if (controller.hasPendingRetry) ...[
                IconButton(
                  key: const ValueKey('face-retry'),
                  tooltip: '重试'.tr(context),
                  onPressed: controller.retryPending,
                  icon: const Icon(Icons.refresh),
                ),
                IconButton(
                  key: const ValueKey('face-discard-pending'),
                  tooltip: '放弃本句'.tr(context),
                  onPressed: onDiscard,
                  icon: const Icon(Icons.delete_outline),
                ),
              ] else
                IconButton(
                  key: const ValueKey('face-clear'),
                  tooltip: '清空'.tr(context),
                  onPressed: onClear,
                  icon: const Icon(Icons.delete_sweep_outlined),
                ),
            ],
          ),
        ),
      );

  static String _statusText(FaceToFaceController controller) {
    final notice = controller.notice;
    if (notice?.isNotEmpty == true) return notice!;
    return switch (controller.phase) {
      FaceToFacePhase.recording =>
        controller.activeLanguage == Language.ru ? '正在录俄语…' : '正在录中文…',
      FaceToFacePhase.translating => '正在识别和翻译…',
      FaceToFacePhase.playing => '正在播放译文…',
      FaceToFacePhase.idle => '两人轮流按住自己的语言按钮说话',
    };
  }
}

final class FaceToFaceTalkButton extends StatelessWidget {
  const FaceToFaceTalkButton({
    required this.language,
    required this.phase,
    required this.activeLanguage,
    required this.enabled,
    required this.onStart,
    required this.onEnd,
    required this.onCancel,
    super.key,
  });

  final Language language;
  final FaceToFacePhase phase;
  final Language? activeLanguage;
  final bool enabled;
  final VoidCallback onStart;
  final VoidCallback onEnd;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final recording =
        phase == FaceToFacePhase.recording && activeLanguage == language;
    final canRelease = recording;
    final visuallyEnabled = enabled || canRelease;
    return GestureDetector(
      key: ValueKey('face-talk-gesture-${language.code}'),
      onLongPressStart: enabled ? (_) => onStart() : null,
      onLongPressEnd: canRelease ? (_) => onEnd() : null,
      onLongPressCancel: canRelease ? onCancel : null,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        height: 56,
        decoration: BoxDecoration(
          color: !visuallyEnabled
              ? Colors.grey.shade300
              : recording
                  ? Colors.red
                  : Theme.of(context).colorScheme.primary,
          borderRadius: BorderRadius.circular(18),
        ),
        alignment: Alignment.center,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              recording ? Icons.mic : Icons.mic_none,
              color: visuallyEnabled ? Colors.white : Colors.black45,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                recording
                    ? (language == Language.zh ? '松开发送' : 'Отпустите')
                    : language == Language.zh
                        ? '按住说中文'
                        : 'Говорить по-русски',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: visuallyEnabled ? Colors.white : Colors.black45,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
