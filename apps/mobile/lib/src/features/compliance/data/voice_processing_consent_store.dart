import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const voiceProcessingConsentVersion = 'domestic-voice-processing-consent-v1';

class VoiceProcessingConsentRecord {
  const VoiceProcessingConsentRecord({
    required this.version,
    required this.acceptedAtIso,
  });

  final String version;
  final String acceptedAtIso;

  Map<String, Object?> toJson() => <String, Object?>{
        'version': version,
        'acceptedAtIso': acceptedAtIso,
      };

  static VoiceProcessingConsentRecord? fromJson(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final version = json['version'];
    final acceptedAtIso = json['acceptedAtIso'];
    if (version is! String || acceptedAtIso is! String) return null;
    return VoiceProcessingConsentRecord(
      version: version,
      acceptedAtIso: acceptedAtIso,
    );
  }
}

abstract class VoiceProcessingConsentStore {
  Future<VoiceProcessingConsentRecord?> load();
  Future<void> accept(String version);
}

class FileVoiceProcessingConsentStore implements VoiceProcessingConsentStore {
  const FileVoiceProcessingConsentStore();

  @override
  Future<VoiceProcessingConsentRecord?> load() async {
    try {
      final file = await _consentFile();
      if (!await file.exists()) return null;
      return VoiceProcessingConsentRecord.fromJson(
        jsonDecode(await file.readAsString()),
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> accept(String version) async {
    final file = await _consentFile();
    await file.parent.create(recursive: true);
    final record = VoiceProcessingConsentRecord(
      version: version,
      acceptedAtIso: DateTime.now().toUtc().toIso8601String(),
    );
    await file.writeAsString(jsonEncode(record.toJson()));
  }

  Future<File> _consentFile() async {
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/voice_processing_consent.json');
  }
}

class MemoryVoiceProcessingConsentStore implements VoiceProcessingConsentStore {
  MemoryVoiceProcessingConsentStore([this._record]);

  MemoryVoiceProcessingConsentStore.accepted()
      : _record = VoiceProcessingConsentRecord(
          version: voiceProcessingConsentVersion,
          acceptedAtIso: DateTime.utc(2026).toIso8601String(),
        );

  VoiceProcessingConsentRecord? _record;

  VoiceProcessingConsentRecord? get record => _record;

  @override
  Future<VoiceProcessingConsentRecord?> load() async => _record;

  @override
  Future<void> accept(String version) async {
    _record = VoiceProcessingConsentRecord(
      version: version,
      acceptedAtIso: DateTime.now().toUtc().toIso8601String(),
    );
  }
}
