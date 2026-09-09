import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'package:crypto/crypto.dart';

import 'package:path_provider/path_provider.dart';

part 'deployment_account_session_store.dart';

const configuredPublicDeploymentId =
    String.fromEnvironment('PUBLIC_DEPLOYMENT_ID');

abstract interface class AccountSessionGeneration {
  int get generation;
}

class AccountSession {
  const AccountSession({
    required this.token,
    required this.expiresAtIso,
    this.deploymentId,
    this.ownerId,
    this.issuerOrigin,
  });

  final String token;
  final String expiresAtIso;
  final String? deploymentId, ownerId, issuerOrigin;

  Map<String, Object?> toJson() => <String, Object?>{
        'token': token,
        'expiresAtIso': expiresAtIso,
        if (deploymentId != null) 'deploymentId': deploymentId,
        if (ownerId != null) 'ownerId': ownerId,
        if (issuerOrigin != null) 'issuerOrigin': issuerOrigin,
      };

  static AccountSession? fromJson(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final token = json['token'];
    final expiresAtIso = json['expiresAtIso'];
    if (token is! String || expiresAtIso is! String) return null;
    return AccountSession(
        token: token,
        expiresAtIso: expiresAtIso,
        deploymentId: json['deploymentId'] as String?,
        ownerId: json['ownerId'] as String?,
        issuerOrigin: json['issuerOrigin'] as String?);
  }
}

abstract class AccountSessionStore {
  Future<AccountSession?> load();
  Future<void> save(AccountSession session);
  Future<void> clear();
}

class FileAccountSessionStore implements AccountSessionStore {
  const FileAccountSessionStore({this.scope});
  final AccountRequestScope? scope;

  @override
  Future<AccountSession?> load() async {
    try {
      final file = await _sessionFile();
      if (!await file.exists()) return null;
      final session =
          AccountSession.fromJson(jsonDecode(await file.readAsString()));
      return session != null && (scope == null || scope!.matches(session))
          ? session
          : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(AccountSession session) async {
    if (scope != null && !scope!.matches(session)) {
      throw StateError('Account scope mismatch');
    }
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
    final suffix = scope == null ? '' : '_v11_${scope!.storageKey}';
    return File('${directory.path}/account_session$suffix.json');
  }
}

/// A public credential namespace is explicit; legacy credentials are never
/// implicitly migrated or rebound to the current login/deployment.
class AccountRequestScope {
  AccountRequestScope(
      {required this.deploymentId,
      required this.ownerId,
      required Uri apiBaseUrl})
      : issuerOrigin = apiBaseUrl.origin {
    if (deploymentId.trim().isEmpty ||
        ownerId.trim().isEmpty ||
        apiBaseUrl.userInfo.isNotEmpty ||
        apiBaseUrl.hasQuery ||
        apiBaseUrl.hasFragment ||
        (apiBaseUrl.scheme != 'https' &&
            !(apiBaseUrl.scheme == 'http' &&
                ['localhost', '127.0.0.1', '::1'].contains(apiBaseUrl.host)))) {
      throw ArgumentError('Invalid account request scope');
    }
  }
  final String deploymentId, ownerId, issuerOrigin;
  bool matches(AccountSession session) =>
      session.deploymentId == deploymentId &&
      session.ownerId == ownerId &&
      session.issuerOrigin == issuerOrigin;
  String get storageKey => sha256
      .convert(utf8.encode(jsonEncode([deploymentId, ownerId, issuerOrigin])))
      .toString();
}

class MemoryAccountSessionStore
    implements AccountSessionStore, AccountSessionGeneration {
  MemoryAccountSessionStore([this._session]);

  AccountSession? _session;
  @override
  int generation = 0;

  AccountSession? get session => _session;

  @override
  Future<AccountSession?> load() async => _session;

  @override
  Future<void> save(AccountSession session) async {
    generation++;
    _session = session;
  }

  @override
  Future<void> clear() async {
    generation++;
    _session = null;
  }
}
