import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

class AccountSession {
  const AccountSession({
    required this.token,
    required this.expiresAtIso,
  });

  final String token;
  final String expiresAtIso;

  Map<String, Object?> toJson() => <String, Object?>{
        'token': token,
        'expiresAtIso': expiresAtIso,
      };

  static AccountSession? fromJson(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final token = json['token'];
    final expiresAtIso = json['expiresAtIso'];
    if (token is! String || expiresAtIso is! String) return null;
    return AccountSession(token: token, expiresAtIso: expiresAtIso);
  }
}

abstract class AccountSessionStore {
  Future<AccountSession?> load();
  Future<void> save(AccountSession session);
  Future<void> clear();
}

class FileAccountSessionStore implements AccountSessionStore {
  const FileAccountSessionStore();

  @override
  Future<AccountSession?> load() async {
    try {
      final file = await _sessionFile();
      if (!await file.exists()) return null;
      return AccountSession.fromJson(jsonDecode(await file.readAsString()));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(AccountSession session) async {
    final file = await _sessionFile();
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode(session.toJson()));
  }

  @override
  Future<void> clear() async {
    final file = await _sessionFile();
    if (await file.exists()) await file.delete();
  }

  Future<File> _sessionFile() async {
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/account_session.json');
  }
}

class MemoryAccountSessionStore implements AccountSessionStore {
  MemoryAccountSessionStore([this._session]);

  AccountSession? _session;

  AccountSession? get session => _session;

  @override
  Future<AccountSession?> load() async => _session;

  @override
  Future<void> save(AccountSession session) async => _session = session;

  @override
  Future<void> clear() async => _session = null;
}
