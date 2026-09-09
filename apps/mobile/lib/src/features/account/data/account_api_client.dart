import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'account_session_store.dart';

class AccountApiClient {
  AccountApiClient(
      {required this.baseUrl,
      http.Client? client,
      this.deploymentId = configuredPublicDeploymentId})
      : _client = client ?? http.Client() {
    if (deploymentId.isNotEmpty) {
      AccountRequestScope(
          deploymentId: deploymentId, ownerId: 'login', apiBaseUrl: baseUrl);
    }
  }

  final Uri baseUrl;
  final String deploymentId;
  AccountSessionStore createSessionStore() =>
      accountStoreForDeployment(baseUrl, deploymentId: deploymentId);
  AccountSession sessionFromLogin(AccountLoginResult result) => AccountSession(
      token: result.token,
      expiresAtIso: result.expiresAt.toUtc().toIso8601String(),
      deploymentId: deploymentId.isEmpty ? null : deploymentId,
      ownerId: deploymentId.isEmpty ? null : result.account.id,
      issuerOrigin: deploymentId.isEmpty ? null : baseUrl.origin);
  bool sessionMatches(AccountSession session) =>
      deploymentId.isEmpty ||
      session.ownerId != null &&
          AccountRequestScope(
                  deploymentId: deploymentId,
                  ownerId: session.ownerId!,
                  apiBaseUrl: baseUrl)
              .matches(session) &&
          (DateTime.tryParse(session.expiresAtIso)?.isAfter(DateTime.now()) ??
              false);
  final http.Client _client;
  static const _requestTimeout = Duration(seconds: 8);

  Future<PhoneCodeChallenge> requestPhoneCode(String phone) async {
    final response = await _post('/auth/phone/request-code', {'phone': phone});
    _checkDeployment(response);
    return PhoneCodeChallenge.fromJson(response);
  }

  Future<AccountLoginResult> loginWithPhoneCode({
    required String phone,
    required String code,
  }) async {
    final response = await _post('/auth/phone/login', {
      'phone': phone,
      'code': code,
    });
    _checkDeployment(response);
    return AccountLoginResult.fromJson(response);
  }

  Future<AccountProfile> fetchMe(String token) async {
    final response = await _get('/account/me', token);
    return AccountProfile.fromJson(response['account'] as Map<String, Object?>);
  }

  Future<AccountExportData> exportData(String token) async {
    return AccountExportData.fromJson(await _get('/account/export', token));
  }

  Future<AccountProfile> requestDeletion(String token) async {
    final response = await _post('/account/delete', const {}, token: token);
    return AccountProfile.fromJson(response['account'] as Map<String, Object?>);
  }

  Future<void> recordConsent({
    required String token,
    required String consentType,
    required String version,
    required String acceptedAtIso,
    String? scene,
    String source = 'mobile',
    String? locale,
  }) async {
    await _post(
        '/account/consents',
        {
          'consentType': consentType,
          'version': version,
          'acceptedAt': acceptedAtIso,
          'source': source,
          if (scene != null) 'scene': scene,
          if (locale != null) 'locale': locale,
        },
        token: token);
  }

  Future<void> logout(String token) async {
    await _post('/auth/logout', const {}, token: token);
  }

  void close() => _client.close();

  void _checkDeployment(Map<String, Object?> response) {
    if (deploymentId.isNotEmpty && response['deploymentId'] != deploymentId) {
      throw const AccountApiException('Public login deployment mismatch', {});
    }
  }

  Future<Map<String, Object?>> _get(String path, String token) async {
    final response = await _send(path, () async {
      if (deploymentId.isNotEmpty) {
        await verifyAccountDeployment(
            _client, baseUrl, deploymentId, _requestTimeout);
      }
      if (deploymentId.isNotEmpty) {
        return _boundRequest('GET', path, {'authorization': 'Bearer $token'});
      }
      return _client.get(
        baseUrl.resolve(path),
        headers: {'authorization': 'Bearer $token'},
      );
    });
    return _decode(response, path);
  }

  Future<Map<String, Object?>> _post(
    String path,
    Map<String, Object?> body, {
    String? token,
  }) async {
    final response = await _send(path, () async {
      if (deploymentId.isNotEmpty) {
        await verifyAccountDeployment(
            _client, baseUrl, deploymentId, _requestTimeout);
      }
      if (deploymentId.isNotEmpty) {
        return _boundRequest(
            'POST',
            path,
            {
              'content-type': 'application/json',
              if (token != null) 'authorization': 'Bearer $token'
            },
            jsonEncode({
              ...body,
              if (path.startsWith('/auth/phone/')) 'deploymentId': deploymentId
            }));
      }
      return _client.post(
        baseUrl.resolve(path),
        headers: <String, String>{
          'content-type': 'application/json',
          if (token != null) 'authorization': 'Bearer $token',
        },
        body: jsonEncode({
          ...body,
          if (deploymentId.isNotEmpty && path.startsWith('/auth/phone/'))
            'deploymentId': deploymentId
        }),
      );
    });
    return _decode(response, path);
  }

  Future<http.Response> _send(
    String path,
    Future<http.Response> Function() request,
  ) async {
    try {
      return await request().timeout(_requestTimeout);
    } on TimeoutException {
      throw AccountApiException('$path timed out after 8s', const {
        'error': {'code': 'network_timeout'},
      });
    } catch (error) {
      throw AccountApiException('$path network error: $error', const {
        'error': {'code': 'network_error'},
      });
    }
  }

  Future<http.Response> _boundRequest(
      String method, String path, Map<String, String> headers,
      [String? body]) async {
    final request = http.Request(method, baseUrl.resolve(path))
      ..followRedirects = false;
    request.headers.addAll(headers);
    if (body != null) request.body = body;
    return http.Response.fromStream(await _client.send(request));
  }

  Map<String, Object?> _decode(http.Response response, String path) {
    final json = jsonDecode(response.body) as Map<String, Object?>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AccountApiException('$path failed: ${response.statusCode}', json);
    }
    return json;
  }
}

Future<void> verifyAccountDeployment(http.Client client, Uri baseUrl,
    String deploymentId, Duration timeout) async {
  final request = http.Request('GET', baseUrl.resolve('/auth/deployment'))
    ..followRedirects = false;
  final response =
      await (() async => http.Response.fromStream(await client.send(request)))()
          .timeout(timeout);
  if (response.statusCode != 200 ||
      (jsonDecode(response.body) as Map)['deploymentId'] != deploymentId) {
    throw const AccountApiException('Public deployment identity not ready', {});
  }
}

class AccountApiException implements Exception {
  const AccountApiException(this.message, this.body);

  final String message;
  final Map<String, Object?> body;

  @override
  String toString() => message;
}

class PhoneCodeChallenge {
  const PhoneCodeChallenge({
    required this.challengeId,
    required this.phoneMasked,
    required this.expiresAt,
    this.debugCode,
  });

  final String challengeId;
  final String phoneMasked;
  final DateTime expiresAt;
  final String? debugCode;

  factory PhoneCodeChallenge.fromJson(Map<String, Object?> json) {
    return PhoneCodeChallenge(
      challengeId: json['challengeId'] as String,
      phoneMasked: json['phoneMasked'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      debugCode: json['debugCode'] as String?,
    );
  }
}

class AccountLoginResult {
  const AccountLoginResult({
    required this.token,
    required this.expiresAt,
    required this.account,
  });

  final String token;
  final DateTime expiresAt;
  final AccountProfile account;

  factory AccountLoginResult.fromJson(Map<String, Object?> json) {
    return AccountLoginResult(
      token: json['token'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      account: AccountProfile.fromJson(json['account'] as Map<String, Object?>),
    );
  }
}

class AccountProfile {
  const AccountProfile({
    required this.id,
    required this.phoneMasked,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String phoneMasked;
  final String status;
  final DateTime createdAt;

  factory AccountProfile.fromJson(Map<String, Object?> json) {
    return AccountProfile(
      id: json['id'] as String,
      phoneMasked: json['phoneMasked'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}

class AccountExportData {
  const AccountExportData({
    required this.exportedAt,
    required this.sessionCount,
    required this.ledgerCount,
    required this.termCount,
    required this.agentCallCount,
    required this.consentCount,
  });

  final DateTime exportedAt;
  final int sessionCount;
  final int ledgerCount;
  final int termCount;
  final int agentCallCount;
  final int consentCount;

  factory AccountExportData.fromJson(Map<String, Object?> json) {
    return AccountExportData(
      exportedAt: DateTime.parse(json['exportedAt'] as String),
      sessionCount: (json['sessions'] as List<dynamic>).length,
      ledgerCount: (json['billingLedger'] as List<dynamic>).length,
      termCount: (json['termbaseTerms'] as List<dynamic>).length,
      agentCallCount: (json['agentCalls'] as List<dynamic>).length,
      consentCount: (json['consents'] as List<dynamic>? ?? const []).length,
    );
  }
}
