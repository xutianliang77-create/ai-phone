import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'package:crypto/crypto.dart';

import 'package:path_provider/path_provider.dart';
import 'keychain_account_session_store.dart';

part 'deployment_account_session_store.dart';

const configuredExecutionMode = String.fromEnvironment('WUJIE_EXECUTION_MODE', defaultValue:'server');
const onDeviceExecution = configuredExecutionMode=='on_device';
const configuredAccountBackend = String.fromEnvironment(
  'ACCOUNT_CONTROL_BACKEND',
);
const _controlOrigin = String.fromEnvironment('CONTROL_API_BASE_URL');
const configuredAccountApiBaseUrl = _controlOrigin == ''
    ? String.fromEnvironment('API_BASE_URL')
    : _controlOrigin;
const configuredProcessingApiBaseUrl = String.fromEnvironment('API_BASE_URL');
const configuredPublicDeploymentId = String.fromEnvironment(
  'ACCOUNT_DEPLOYMENT_ID',
);
const selfHostedAccountEnabled =
    configuredAccountBackend == 'self_hosted' ||
    configuredAccountBackend == 'cloudflare';
const configuredPublicBundleId = String.fromEnvironment('PUBLIC_BUNDLE_ID');
const configuredPrivacyVersion = String.fromEnvironment(
  'PRIVACY_POLICY_VERSION',
);
const configuredTermsVersion = String.fromEnvironment('TERMS_VERSION');

void requireAccountOrigin(Uri baseUrl, String deploymentId) {
  final configured = Uri.tryParse(configuredAccountApiBaseUrl);
  if (!selfHostedAccountEnabled ||
      deploymentId.isEmpty ||
      configured == null ||
      baseUrl.scheme != 'https' ||
      configured.scheme != 'https' ||
      baseUrl.origin != configured.origin ||
      baseUrl.userInfo.isNotEmpty ||
      baseUrl.hasQuery ||
      baseUrl.hasFragment ||
      !const ['', '/'].contains(baseUrl.path)) {
    throw ArgumentError(
      'Configured account identity and HTTPS origin required',
    );
  }
}

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
      issuerOrigin: json['issuerOrigin'] as String?,
    );
  }
}

AccountSessionStore defaultAccountSessionStore() => selfHostedAccountEnabled
    ? accountStoreForDeployment(Uri.parse(configuredAccountApiBaseUrl))
    : const FileAccountSessionStore();

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
      final session = AccountSession.fromJson(
        jsonDecode(await file.readAsString()),
      );
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
  AccountRequestScope({
    required this.deploymentId,
    required this.ownerId,
    required Uri apiBaseUrl,
  }) : issuerOrigin = apiBaseUrl.origin {
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
