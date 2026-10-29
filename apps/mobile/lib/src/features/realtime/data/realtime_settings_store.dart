import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../account/data/account_session_store.dart' show onDeviceExecution;
import 'realtime_runtime_settings.dart';

abstract class RealtimeSettingsStore {
  Future<RealtimeRuntimeSettings?> load();
  Future<void> save(RealtimeRuntimeSettings settings);
}

class FileRealtimeSettingsStore implements RealtimeSettingsStore {
  const FileRealtimeSettingsStore({this.directory, this.useVersionedFile});
  final Future<Directory> Function()? directory;
  final bool? useVersionedFile;
  bool get _versioned => useVersionedFile ?? onDeviceExecution;

  @override
  Future<RealtimeRuntimeSettings?> load() async {
    try {
      var file = await _settingsFile();
      if (!await file.exists() && _versioned) {
        file = await _legacySettingsFile();
      }
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
    final directory =
        await (this.directory ?? getApplicationSupportDirectory)();
    return File(
      '${directory.path}/${_versioned ? 'realtime_settings_on_device_v1.json' : 'realtime_settings.json'}',
    );
  }

  Future<File> _legacySettingsFile() async {
    final directory =
        await (this.directory ?? getApplicationSupportDirectory)();
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
