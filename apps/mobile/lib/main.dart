import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/audio/pending_audio_registry.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await PendingAudioRegistry.cleanupCrashResidue();
  } catch (_) {
    // Startup remains available even if the platform temp directory is not.
  }
  runApp(const ProviderScope(child: TranslatorApp()));
}
