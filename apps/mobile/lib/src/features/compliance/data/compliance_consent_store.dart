import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const complianceConsentVersion = 'domestic-initial-consent-v1';

class ComplianceConsentRecord {
  const ComplianceConsentRecord({
    required this.version,
    required this.acceptedAtIso,
  });

  final String version;
  final String acceptedAtIso;

  Map<String, Object?> toJson() => <String, Object?>{
        'version': version,
        'acceptedAtIso': acceptedAtIso,
      };

  static ComplianceConsentRecord? fromJson(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final version = json['version'];
    final acceptedAtIso = json['acceptedAtIso'];
    if (version is! String || acceptedAtIso is! String) return null;
    return ComplianceConsentRecord(
      version: version,
      acceptedAtIso: acceptedAtIso,
    );
  }
}

abstract class ComplianceConsentStore {
  Future<ComplianceConsentRecord?> load();
  Future<void> accept(String version);
}

class FileComplianceConsentStore implements ComplianceConsentStore {
  const FileComplianceConsentStore();

  @override
  Future<ComplianceConsentRecord?> load() async {
    try {
      final file = await _consentFile();
      if (!await file.exists()) return null;
      return ComplianceConsentRecord.fromJson(
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
    final record = ComplianceConsentRecord(
      version: version,
      acceptedAtIso: DateTime.now().toUtc().toIso8601String(),
    );
    await file.writeAsString(jsonEncode(record.toJson()));
  }

  Future<File> _consentFile() async {
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/compliance_consent.json');
  }
}

class MemoryComplianceConsentStore implements ComplianceConsentStore {
  MemoryComplianceConsentStore([this._record]);

  MemoryComplianceConsentStore.accepted()
      : _record = ComplianceConsentRecord(
          version: complianceConsentVersion,
          acceptedAtIso: DateTime.utc(2026).toIso8601String(),
        );

  ComplianceConsentRecord? _record;

  ComplianceConsentRecord? get record => _record;

  @override
  Future<ComplianceConsentRecord?> load() async => _record;

  @override
  Future<void> accept(String version) async {
    _record = ComplianceConsentRecord(
      version: version,
      acceptedAtIso: DateTime.now().toUtc().toIso8601String(),
    );
  }
}
