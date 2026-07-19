import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/cache/app_preferences.dart';
import '../../core/localization/app_localization.dart';
import '../../core/providers.dart';

final settingsControllerProvider =
    AsyncNotifierProvider<SettingsController, AppSettings>(
        SettingsController.new);

final class SettingsController extends AsyncNotifier<AppSettings> {
  @override
  Future<AppSettings> build() => ref.read(appPreferencesProvider).load();

  Future<void> setAutoPlay(bool enabled) async {
    final current = state.valueOrNull ?? const AppSettings();
    final next = current.copyWith(autoPlay: enabled);
    state = AsyncData(next);
    await ref.read(appPreferencesProvider).save(next);
  }

  Future<void> setPlaybackSpeed(double speed) async {
    final current = state.valueOrNull ?? const AppSettings();
    final next = current.copyWith(playbackSpeed: speed);
    state = AsyncData(next);
    await ref.read(appPreferencesProvider).save(next);
    await ref.read(audioPlaybackProvider).setSpeed(speed);
  }

  Future<void> setLanguageMode(AppLanguageMode mode) async {
    final current = state.valueOrNull ?? const AppSettings();
    final next = current.copyWith(languageMode: mode);
    state = AsyncData(next);
    await ref.read(appPreferencesProvider).save(next);
  }
}
