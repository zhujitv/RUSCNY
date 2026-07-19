import '../localization/app_localization.dart';
import 'local_database.dart';

final class AppSettings {
  const AppSettings({
    this.autoPlay = true,
    this.playbackSpeed = 1,
    this.languageMode = AppLanguageMode.system,
  });

  final bool autoPlay;
  final double playbackSpeed;
  final AppLanguageMode languageMode;

  AppSettings copyWith({
    bool? autoPlay,
    double? playbackSpeed,
    AppLanguageMode? languageMode,
  }) =>
      AppSettings(
        autoPlay: autoPlay ?? this.autoPlay,
        playbackSpeed: playbackSpeed ?? this.playbackSpeed,
        languageMode: languageMode ?? this.languageMode,
      );
}

final class AppPreferences {
  const AppPreferences(this._database);

  static const _autoPlayKey = 'audio.autoplay';
  static const _playbackSpeedKey = 'audio.playback_speed';
  static const _languageModeKey = 'app.language';

  final LocalDatabase _database;

  Future<AppSettings> load() async {
    final autoPlay = await _database.preference(_autoPlayKey);
    final speed = await _database.preference(_playbackSpeedKey);
    final languageMode = await _database.preference(_languageModeKey);
    return AppSettings(
      autoPlay: autoPlay == null || autoPlay == 'true',
      playbackSpeed: double.tryParse(speed ?? '') ?? 1,
      languageMode: AppLanguageMode.parse(languageMode),
    );
  }

  Future<void> save(AppSettings value) async {
    await Future.wait([
      _database.setPreference(_autoPlayKey, value.autoPlay.toString()),
      _database.setPreference(
        _playbackSpeedKey,
        value.playbackSpeed.toString(),
      ),
      _database.setPreference(_languageModeKey, value.languageMode.name),
    ]);
  }
}
