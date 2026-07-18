import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';

abstract class VoiceIdentityClient {
  Future<List<VoiceIdentity>> list();
  Future<VoiceIdentity> create({
    required String displayName,
    required String consentVersion,
  });
  Future<VoiceIdentity> enroll({
    required String identityId,
    required String audioBase64,
  });
  Future<VoiceIdentity> revoke(String identityId);
  Future<VoiceIdentity> delete(String identityId);
}

class VoiceIdentity {
  const VoiceIdentity({
    required this.id,
    required this.displayName,
    required this.status,
    required this.matchThreshold,
  });

  final String id;
  final String displayName;
  final String status;
  final double matchThreshold;

  bool get ready => status == 'ready';

  factory VoiceIdentity.fromJson(Map<String, Object?> json) {
    return VoiceIdentity(
      id: json['id'] as String,
      displayName: json['displayName'] as String,
      status: json['status'] as String,
      matchThreshold: (json['matchThreshold'] as num).toDouble(),
    );
  }
}

class VoiceIdentityApiClient implements VoiceIdentityClient {
  static const _defaultRequestTimeout = Duration(seconds: 8);
  static const _defaultEnrollmentTimeout = Duration(seconds: 35);

  VoiceIdentityApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore accountSessionStore = const FileAccountSessionStore(),
    Duration requestTimeout = _defaultRequestTimeout,
    Duration enrollmentTimeout = _defaultEnrollmentTimeout,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore,
        _requestTimeout = requestTimeout,
        _enrollmentTimeout = enrollmentTimeout;

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;
  final Duration _requestTimeout;
  final Duration _enrollmentTimeout;

  @override
  Future<List<VoiceIdentity>> list() async {
    final json = await _request('GET', '/voice-identities');
    final values = json['identities'] as List? ?? const [];
    return values
        .map((value) => VoiceIdentity.fromJson(
              Map<String, Object?>.from(value as Map),
            ))
        .toList(growable: false);
  }

  @override
  Future<VoiceIdentity> create({
    required String displayName,
    required String consentVersion,
  }) async {
    final json = await _request('POST', '/voice-identities', body: {
      'displayName': displayName,
      'consentAccepted': true,
      'consentVersion': consentVersion,
    });
    return _identity(json);
  }

  @override
  Future<VoiceIdentity> enroll({
    required String identityId,
    required String audioBase64,
  }) async {
    final json = await _request(
      'POST',
      '/voice-identities/$identityId/reference-audio',
      body: {'audioBase64': audioBase64},
      timeout: _enrollmentTimeout,
    );
    return _identity(json);
  }

  @override
  Future<VoiceIdentity> revoke(String identityId) async {
    return _identity(await _request(
      'POST',
      '/voice-identities/$identityId/revoke',
      body: const {},
    ));
  }

  @override
  Future<VoiceIdentity> delete(String identityId) async {
    return _identity(await _request('DELETE', '/voice-identities/$identityId'));
  }

  Future<Map<String, Object?>> _request(
    String method,
    String path, {
    Map<String, Object?>? body,
    Duration? timeout,
  }) async {
    final request = http.Request(method, _baseUrl.resolve(path));
    request.headers.addAll(await accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders:
          body == null ? const {} : const {'content-type': 'application/json'},
    ));
    if (body != null) request.body = jsonEncode(body);
    final response = await (() async {
      final streamed = await _client.send(request);
      return http.Response.fromStream(streamed);
    })()
        .timeout(timeout ?? _requestTimeout);
    final json = jsonDecode(response.body) as Map<String, Object?>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw VoiceIdentityApiException(response.statusCode, json);
    }
    return json;
  }

  VoiceIdentity _identity(Map<String, Object?> json) {
    return VoiceIdentity.fromJson(
      Map<String, Object?>.from(json['identity'] as Map),
    );
  }

  void close() => _client.close();
}

class VoiceIdentityApiException implements Exception {
  const VoiceIdentityApiException(this.statusCode, this.body);

  final int statusCode;
  final Map<String, Object?> body;

  @override
  String toString() => 'Voice identity API failed: $statusCode';
}
