import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';
import 'call_link_models.dart';
import 'sip_call_models.dart';

export 'call_link_models.dart';
export 'sip_call_models.dart';

part 'call_link_translation_control_api.dart';
part 'call_link_phone_status_api.dart';

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
      throw _failure(response, 'Create call link failed');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return CallLink.fromJson(json);
  }

  Future<CallLink> getCallLink({required String callId}) async {
    final response = await _client.get(_baseUrl.resolve('/call-links/$callId'));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _failure(response, 'Get call link failed');
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
      throw _failure(response, 'Create room token failed');
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
      throw _failure(response, 'Rotate guest ticket failed');
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
      throw _failure(response, 'Confirm room connection failed');
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
      throw _failure(response, 'Start SIP outbound failed');
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
      throw _failure(response, 'Start Air780 outbound failed');
    }
    return SipOutboundCall.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<Air780CallStatus> getAir780Status({required String callId}) async {
    final response = await _client.get(
      _baseUrl.resolve('/call-links/$callId/air780-status'),
      headers: await _authHeaders(),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _failure(response, 'Get Air780 call status failed');
    }
    return Air780CallStatus.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<PhoneCallStatus> getPhoneStatus({required String callId}) =>
      _getPhoneStatus(this, callId);

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

  Future<SipControlResult> sendAir780Dtmf({
    required String callId,
    required String digit,
    required String idempotencyKey,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/call-links/$callId/air780-dtmf'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'digit': digit,
        'idempotencyKey': idempotencyKey,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _failure(response, 'Air780 DTMF failed');
    }
    return SipControlResult.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
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
      throw _failure(response, 'Air780 hangup failed');
    }
    return SipControlResult.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<TranslationCallControlResult> typeToSpeak({
    required String callId,
    required String text,
    required String idempotencyKey,
  }) => _typeToSpeak(this, callId, text, idempotencyKey);

  Future<TranslationCallControlResult> setTranslationUplinkPaused({
    required String callId,
    required bool paused,
    required String idempotencyKey,
  }) => _setTranslationUplinkPaused(
        this, callId, paused, idempotencyKey,
      );

  Future<TranslationCallControlResult> getTranslationControlStatus({
    required String callId,
    required String operationId,
  }) => _getTranslationControlStatus(this, callId, operationId);

  Future<CallDiagnosticMarkerResult> reportCallDiagnosticMarker({
    required String callId,
    required String category,
    required String idempotencyKey,
  }) => _reportCallDiagnosticMarker(
        this, callId, category, idempotencyKey,
      );

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
      throw _failure(response, 'SIP $action failed');
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
      throw _failure(response, 'End call link failed');
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

  CallLinkApiException _failure(http.Response response, String fallback) {
    String? code;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, Object?>) {
        final error = decoded['error'];
        if (error is Map<String, Object?>) {
          code = error['code'] as String?;
        } else {
          code = decoded['code'] as String?;
        }
      }
    } on Object {
      // Error bodies are never surfaced to the app UI.
    }
    return CallLinkApiException(
      fallback,
      code: code,
      statusCode: response.statusCode,
    );
  }
}

class CallLinkApiException implements Exception {
  const CallLinkApiException(
    this.message, {
    this.code,
    this.statusCode,
  });

  final String message;
  final String? code;
  final int? statusCode;

  @override
  String toString() => message;
}
