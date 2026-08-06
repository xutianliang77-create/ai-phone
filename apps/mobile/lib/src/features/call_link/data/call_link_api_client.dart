import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';
import 'sip_call_models.dart';

export 'sip_call_models.dart';

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
    this.activeGuestCount = 0,
  });

  final String callId;
  final String sessionId;
  final String roomName;
  final String roomProvider;
  final String joinUrl;
  final String hostUrl;
  final String status;
  final DateTime expiresAt;
  final int activeGuestCount;

  CallLink withJoinUrl(String value) => CallLink(
        callId: callId,
        sessionId: sessionId,
        roomName: roomName,
        roomProvider: roomProvider,
        joinUrl: value,
        hostUrl: hostUrl,
        status: status,
        expiresAt: expiresAt,
        activeGuestCount: activeGuestCount,
      );

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
      activeGuestCount: (json['activeGuestCount'] as num?)?.toInt() ?? 0,
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
    required this.participantIdentity,
    required this.participantRole,
    required this.token,
    required this.expiresAt,
    this.fullDuplexEnabled = false,
  });

  final String callId;
  final String provider;
  final String roomName;
  final String wsUrl;
  final String participantIdentity;
  final String participantRole;
  final String token;
  final DateTime expiresAt;
  final bool fullDuplexEnabled;

  factory CallRoomToken.fromJson(Map<String, Object?> json) {
    return CallRoomToken(
      callId: json['callId']! as String,
      provider: json['provider']! as String,
      roomName: json['roomName']! as String,
      wsUrl: json['wsUrl']! as String,
      participantIdentity: json['participantIdentity']! as String,
      participantRole: json['participantRole']! as String,
      token: json['token']! as String,
      expiresAt: DateTime.parse(json['expiresAt']! as String),
      fullDuplexEnabled: json['fullDuplexEnabled'] == true,
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
    String? guestTicket,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/room-token'),
      headers: participantRole == 'host'
          ? await _authHeaders(json: true)
          : const {'content-type': 'application/json'},
      body: jsonEncode({
        'participantRole': participantRole,
        if (participantName != null) 'participantName': participantName,
        if (participantRole == 'guest' && guestTicket != null)
          'guestTicket': guestTicket,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException('Create room token failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallRoomToken.fromJson(json);
  }

  Future<String> rotateGuestTicket({required String callId}) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/guest-ticket'),
      headers: await _authHeaders(),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException(
        'Rotate guest ticket failed: ${response.body}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return json['joinUrl']! as String;
  }

  Future<void> confirmRoomConnected(CallRoomToken token) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/${token.callId}/room-connected'),
      headers: token.participantRole == 'host'
          ? await _authHeaders(json: true)
          : const {'content-type': 'application/json'},
      body: jsonEncode({
        'participantIdentity': token.participantIdentity,
        'participantRole': token.participantRole,
        'token': token.token,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException(
        'Confirm room connection failed: ${response.body}',
      );
    }
  }

  Future<SipOutboundCall> startSipOutbound({
    required String callId,
    required String targetPhone,
    required String sourceLanguage,
    required String targetLanguage,
    required bool disclosureConfirmed,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/sip-outbound'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'targetPhone': targetPhone,
        'sourceLanguage': sourceLanguage,
        'targetLanguage': targetLanguage,
        'disclosureConfirmed': disclosureConfirmed,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException(
        'Start SIP outbound failed: ${response.body}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return SipOutboundCall.fromJson(json);
  }

  Future<SipOutboundCall> startAir780Outbound({
    required String callId,
    required String targetPhone,
    required String sourceLanguage,
    required String targetLanguage,
    required bool disclosureConfirmed,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/air780-outbound'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'targetPhone': targetPhone,
        'sourceLanguage': sourceLanguage,
        'targetLanguage': targetLanguage,
        'disclosureConfirmed': disclosureConfirmed,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException(
        'Start Air780 outbound failed: ${response.body}',
      );
    }
    return SipOutboundCall.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<SipControlResult> sendSipDtmf({
    required String callId,
    required String digit,
    required String idempotencyKey,
  }) {
    return _sipControl(
      callId: callId,
      action: 'dtmf',
      body: {'digit': digit, 'idempotencyKey': idempotencyKey},
    );
  }

  Future<SipControlResult> transferSip({
    required String callId,
    required String targetPhone,
    required String idempotencyKey,
  }) {
    return _sipControl(
      callId: callId,
      action: 'transfer',
      body: {'targetPhone': targetPhone, 'idempotencyKey': idempotencyKey},
    );
  }

  Future<SipControlResult> hangupSip({required String callId}) {
    return _sipControl(callId: callId, action: 'hangup', body: const {});
  }

  Future<SipControlResult> hangupAir780({required String callId}) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/air780-hangup'),
      headers: await _authHeaders(json: true),
      body: jsonEncode(const <String, Object?>{}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException(
        'Air780 hangup failed: ${response.body}',
      );
    }
    return SipControlResult.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<SipControlResult> _sipControl({
    required String callId,
    required String action,
    required Map<String, Object?> body,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/sip-$action'),
      headers: await _authHeaders(json: true),
      body: jsonEncode(body),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CallLinkApiException('SIP $action failed: ${response.body}');
    }
    return SipControlResult.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
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
