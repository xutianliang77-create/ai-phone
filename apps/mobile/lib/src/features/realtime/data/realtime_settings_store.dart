import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../../app/app_config.dart';
import 'realtime_runtime_settings.dart';

abstract class RealtimeSettingsStore {
  Future<RealtimeRuntimeSettings?> load();
  Future<void> save(RealtimeRuntimeSettings settings);
}

class FileRealtimeSettingsStore implements RealtimeSettingsStore {
  const FileRealtimeSettingsStore();

  @override
  Future<RealtimeRuntimeSettings?> load() async {
    try {
      final file = await _settingsFile();
      if (!await file.exists()) return null;
      final json = jsonDecode(await file.readAsString());
      if (json is! Map<String, Object?>) return null;
      return RealtimeRuntimeSettings.fromJson(json);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(RealtimeRuntimeSettings settings) async {
    final file = await _settingsFile();
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode(settings.toJson()));
  }

  Future<File> _settingsFile() async {
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/realtime_settings.json');
  }
}

class MemoryRealtimeSettingsStore implements RealtimeSettingsStore {
  MemoryRealtimeSettingsStore([this._settings]);

  RealtimeRuntimeSettings? _settings;

  @override
  Future<RealtimeRuntimeSettings?> load() async => _settings;

  @override
  Future<void> save(RealtimeRuntimeSettings settings) async {
    _settings = settings;
  }
}

/// Reuses the live-translation setting snapshot for other original entry
/// points, without rewriting their own saved language or voice preferences.
Future<AppConfig> resolveRealtimeSettingsConfig(
  AppConfig base,
  RealtimeSettingsStore store,
) async {
  final saved = await store.load();
  return saved?.applyTo(base) ?? base;
}
