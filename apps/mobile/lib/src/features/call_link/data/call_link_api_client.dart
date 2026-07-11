import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';

class CallLink {
  const CallLink({
    required this.callId,
    required this.sessionId,
    required this.roomName,
    required this.roomProvider,
    required this.joinUrl,
    required this.hostUrl,
    required this.status,
    required this.expiresAt,
  });

  final String callId;
  final String sessionId;
  final String roomName;
  final String roomProvider;
  final String joinUrl;
  final String hostUrl;
  final String status;
  final DateTime expiresAt;

  factory CallLink.fromJson(Map<String, Object?> json) {
    return CallLink(
      callId: json['callId']! as String,
      sessionId: (json['sessionId'] ?? json['callId'])! as String,
      roomName: json['roomName']! as String,
      roomProvider: json['roomProvider']! as String,
      joinUrl: json['joinUrl']! as String,
      hostUrl: json['hostUrl']! as String,
      status: json['status']! as String,
      expiresAt: DateTime.parse(json['expiresAt']! as String),
    );
  }
}

class CallLinkEndResult {
  const CallLinkEndResult({
    required this.callId,
    required this.sessionId,
    required this.status,
    required this.consumedSeconds,
    required this.endedAt,
  });

  final String callId;
  final String sessionId;
  final String status;
  final int consumedSeconds;
  final DateTime? endedAt;

  factory CallLinkEndResult.fromJson(Map<String, Object?> json) {
    final endedAt = json['endedAt'];
    return CallLinkEndResult(
      callId: json['callId']! as String,
      sessionId: json['sessionId']! as String,
      status: json['status']! as String,
      consumedSeconds: json['consumedSeconds']! as int,
      endedAt: endedAt is String ? DateTime.parse(endedAt) : null,
    );
  }
}

class CallRoomToken {
  const CallRoomToken({
    required this.callId,
    required this.provider,
    required this.roomName,
    required this.wsUrl,
    required this.participantRole,
    required this.token,
    required this.expiresAt,
  });

  final String callId;
  final String provider;
  final String roomName;
  final String wsUrl;
  final String participantRole;
  final String token;
  final DateTime expiresAt;

  factory CallRoomToken.fromJson(Map<String, Object?> json) {
    return CallRoomToken(
      callId: json['callId']! as String,
      provider: json['provider']! as String,
      roomName: json['roomName']! as String,
      wsUrl: json['wsUrl']! as String,
      participantRole: json['participantRole']! as String,
      token: json['token']! as String,
      expiresAt: DateTime.parse(json['expiresAt']! as String),
    );
  }
}

class CallLinkApiClient {
  CallLinkApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore accountSessionStore = const FileAccountSessionStore(),
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore;

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

  Future<CallLink> createCallLink() async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links'),
      headers: await _authHeaders(),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException('Create call link failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallLink.fromJson(json);
  }

  Future<CallLink> getCallLink({required String callId}) async {
    final response = await _client.get(_baseUrl.resolve('/call-links/$callId'));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException('Get call link failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallLink.fromJson(json);
  }

  Future<CallRoomToken> createRoomToken({
    required String callId,
    String participantRole = 'host',
    String? participantName,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/room-token'),
      headers: participantRole == 'host'
          ? await _authHeaders(json: true)
          : const {'content-type': 'application/json'},
      body: jsonEncode({
        'participantRole': participantRole,
        if (participantName != null) 'participantName': participantName,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException('Create room token failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallRoomToken.fromJson(json);
  }

  Future<CallLinkEndResult> endCallLink({required String callId}) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/end'),
      headers: await _authHeaders(),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException('End call link failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallLinkEndResult.fromJson(json);
  }

  void close() {
    _client.close();
  }

  Future<Map<String, String>> _authHeaders({bool json = false}) {
    return accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders: json
          ? const {'content-type': 'application/json'}
          : const <String, String>{},
    );
  }
}

class CallLinkApiException implements Exception {
  const CallLinkApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
