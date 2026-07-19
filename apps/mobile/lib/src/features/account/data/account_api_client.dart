import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class AccountApiClient {
  AccountApiClient({required this.baseUrl, http.Client? client})
      : _client = client ?? http.Client();

  final Uri baseUrl;
  final http.Client _client;
  static const _requestTimeout = Duration(seconds: 8);

  Future<PhoneCodeChallenge> requestPhoneCode(String phone) async {
    final response = await _post('/auth/phone/request-code', {'phone': phone});
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

  Future<Map<String, Object?>> _get(String path, String token) async {
    final response = await _send(path, () {
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
    final response = await _send(path, () {
      return _client.post(
        baseUrl.resolve(path),
        headers: <String, String>{
          'content-type': 'application/json',
          if (token != null) 'authorization': 'Bearer $token',
        },
        body: jsonEncode(body),
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

  Map<String, Object?> _decode(http.Response response, String path) {
    final json = jsonDecode(response.body) as Map<String, Object?>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AccountApiException('$path failed: ${response.statusCode}', json);
    }
    return json;
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
