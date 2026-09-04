import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:path_provider/path_provider.dart';

abstract class VoiceClientInstanceStore {
  Future<String> loadOrCreate();
}

class FileVoiceClientInstanceStore implements VoiceClientInstanceStore {
  Future<String>? _pending;

  @override
  Future<String> loadOrCreate() => _pending ??= _loadOrCreate();

  Future<String> _loadOrCreate() async {
    final file = await _instanceFile();
    try {
      if (await file.exists()) {
        final existing = (await file.readAsString()).trim();
        if (_isValid(existing)) return existing;
      }
    } catch (_) {
      // A damaged local identifier is replaced with a fresh non-secret value.
    }
    final value = _generate();
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(value, flush: true);
    await temporary.rename(file.path);
    return value;
  }

  Future<File> _instanceFile() async {
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/voice_client_instance_id');
  }

  String _generate() {
    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return 'vci_${base64Url.encode(bytes).replaceAll('=', '')}';
  }

  bool _isValid(String value) =>
      RegExp(r'^vci_[A-Za-z0-9_-]{32}$').hasMatch(value);
}

class MemoryVoiceClientInstanceStore implements VoiceClientInstanceStore {
  MemoryVoiceClientInstanceStore([
    this.value = 'vci_0123456789abcdefghijklmnopqrstuv',
  ]);

  final String value;

  @override
  Future<String> loadOrCreate() async => value;
}
