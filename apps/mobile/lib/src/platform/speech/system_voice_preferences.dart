import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Separate from the legacy server-preset settings. A malformed file is not
/// silently overwritten: the caller can report the problem and preserve it.
class SystemVoicePreferences {
  SystemVoicePreferences({Future<Directory> Function()? directory})
    : _directory = directory ?? getApplicationSupportDirectory;

  static final shared = SystemVoicePreferences();
  final Future<Directory> Function() _directory;
  Future<void> _writes = Future<void>.value();

  Future<File> _file() async =>
      File('${(await _directory()).path}/system_voice_selections_v1.json');

  String _language(String language) {
    final value = language.trim().replaceAll('_', '-').toLowerCase();
    if (!RegExp(r'^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$').hasMatch(value)) {
      throw ArgumentError('invalid language');
    }
    return value;
  }

  Future<Map<String, String>> _read() async {
    final file = await _file();
    if (!await file.exists()) return <String, String>{};
    final data = jsonDecode(await file.readAsString());
    if (data is! Map || data['version'] != 1 || data['voices'] is! Map) {
      throw const FormatException('invalid system voice preferences');
    }
    final voices = data['voices'] as Map;
    if (voices.keys.any((key) => key is! String) ||
        voices.values.any((value) => value is! String)) {
      throw const FormatException('invalid system voice preferences');
    }
    return voices.map((key, value) => MapEntry(key as String, value as String));
  }

  Future<String?> selected(String language) async {
    await _writes;
    return (await _read())[_language(language)];
  }

  Future<void> select(String language, String? identifier) {
    final key = _language(language);
    if (identifier != null &&
        !RegExp(r'^[A-Za-z0-9._-]{1,256}$').hasMatch(identifier)) {
      throw ArgumentError('invalid voice identifier');
    }
    final action = _writes.then((_) async {
      final voices = await _read();
      if (identifier == null) {
        voices.remove(key);
      } else {
        voices[key] = identifier;
      }
      final file = await _file();
      await file.parent.create(recursive: true);
      final temporary = File('${file.path}.tmp');
      await temporary.writeAsString(
        jsonEncode({'version': 1, 'voices': voices}),
        flush: true,
      );
      await temporary.rename(file.path);
    });
    _writes = action.catchError((Object _) {});
    return action;
  }
}
