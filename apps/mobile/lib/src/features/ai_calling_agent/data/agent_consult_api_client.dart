import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';
import '../../call_link/data/call_link_api_client.dart';

class AgentConsult {
  const AgentConsult({
    required this.id,
    required this.runId,
    required this.sessionId,
    required this.mainRoomName,
    required this.consultRoomName,
    required this.operatorParticipantIdentity,
    required this.status,
    required this.requestedAt,
    required this.expiresAt,
    this.connectedAt,
    this.mergedAt,
    this.completedAt,
    this.failureCode,
  });

  final String id;
  final String runId;
  final String sessionId;
  final String mainRoomName;
  final String consultRoomName;
  final String operatorParticipantIdentity;
  final String status;
  final DateTime requestedAt;
  final DateTime expiresAt;
  final DateTime? connectedAt;
  final DateTime? mergedAt;
  final DateTime? completedAt;
  final String? failureCode;

  bool get isTerminal =>
      const {'rejected', 'no_answer', 'failed', 'completed'}.contains(status);

  factory AgentConsult.fromJson(Map<String, Object?> json) {
    return AgentConsult(
      id: json['id']! as String,
      runId: json['runId']! as String,
      sessionId: json['sessionId']! as String,
      mainRoomName: json['mainRoomName']! as String,
      consultRoomName: json['consultRoomName']! as String,
      operatorParticipantIdentity:
          json['operatorParticipantIdentity']! as String,
      status: json['status']! as String,
      requestedAt: DateTime.parse(json['requestedAt']! as String),
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      connectedAt: _date(json['connectedAt']),
      mergedAt: _date(json['mergedAt']),
      completedAt: _date(json['completedAt']),
      failureCode: json['failureCode'] as String?,
    );
  }

  static DateTime? _date(Object? value) =>
      value is String ? DateTime.tryParse(value) : null;
}

class AgentConsultApiClient {
  AgentConsultApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore? accountSessionStore,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore ?? accountStoreForDeployment(baseUrl);

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

  Future<AgentConsult> start({
    required String draftId,
    required String targetPhone,
    required String idempotencyKey,
  }) {
    return _post(
      '/ai-calling-agent/drafts/$draftId/consults',
      {
        'targetPhone': targetPhone,
        'idempotencyKey': idempotencyKey,
      },
    );
  }

  Future<AgentConsult> get({
    required String draftId,
    required String consultId,
  }) async {
    final response = await _client.get(
      _baseUrl.resolve(
        '/ai-calling-agent/drafts/$draftId/consults/$consultId',
      ),
      headers: await _headers(),
    );
    return _consultResponse(response, 'Get operator consult');
  }

  Future<CallRoomToken> join({
    required String draftId,
    required String consultId,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve(
        '/ai-calling-agent/drafts/$draftId/consults/$consultId/join',
      ),
      headers: await _headers(json: true),
      body: '{}',
    );
    if (!_success(response)) {
      throw AgentConsultApiException(
        'Join operator consult failed: ${response.body}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallRoomToken.fromJson(json['token']! as Map<String, Object?>);
  }

  Future<AgentConsult> accept({
    required String draftId,
    required String consultId,
    required String participantIdentity,
  }) {
    return _decision(
      draftId: draftId,
      consultId: consultId,
      decision: 'accept',
      participantIdentity: participantIdentity,
    );
  }

  Future<AgentConsult> reject({
    required String draftId,
    required String consultId,
  }) {
    return _decision(
      draftId: draftId,
      consultId: consultId,
      decision: 'reject',
    );
  }

  Future<AgentConsult> complete({
    required String draftId,
    required String consultId,
    required String participantIdentity,
  }) {
    return _decision(
      draftId: draftId,
      consultId: consultId,
      decision: 'complete',
      participantIdentity: participantIdentity,
    );
  }

  Future<AgentConsult> _decision({
    required String draftId,
    required String consultId,
    required String decision,
    String? participantIdentity,
  }) {
    return _post(
      '/ai-calling-agent/drafts/$draftId/consults/$consultId/$decision',
      {
        if (participantIdentity != null)
          'participantIdentity': participantIdentity,
      },
    );
  }

  Future<AgentConsult> _post(String path, Map<String, Object?> body) async {
    final response = await _client.post(
      _baseUrl.resolve(path),
      headers: await _headers(json: true),
      body: jsonEncode(body),
    );
    return _consultResponse(response, 'Operator consult request');
  }

  AgentConsult _consultResponse(http.Response response, String operation) {
    if (!_success(response)) {
      throw AgentConsultApiException('$operation failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return AgentConsult.fromJson(
      json['consult']! as Map<String, Object?>,
    );
  }

  bool _success(http.Response response) =>
      response.statusCode >= 200 && response.statusCode < 300;

  Future<Map<String, String>> _headers({bool json = false}) {
    return accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders: json
          ? const {'content-type': 'application/json'}
          : const <String, String>{},
    );
  }

  void close() => _client.close();
}

class AgentConsultApiException implements Exception {
  const AgentConsultApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
