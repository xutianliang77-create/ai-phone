import '../../../../platform/http/account_bound_http_client.dart';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import '../../../account/data/account_scoped_http.dart';
import 'realtime_creation_journal.dart';

import 'package:http/http.dart' as http;

import '../../../account/data/account_auth_headers.dart';
import '../../../account/data/account_session_store.dart';
import 'realtime_session.dart';
part 'realtime_creation_api.dart';

class RealtimeApiClient {
  static const Duration _defaultRequestTimeout = Duration(seconds: 8);

  RealtimeApiClient({
    required Uri baseUrl,
    http.Client? client,
    String mode = 'conversation',
    String sourceLanguage = 'auto',
    String targetLanguage = 'zh',
    bool autoReverseTargetLanguage = false,
    String voiceOutputMode = 'natural',
    String voicePresetId = 'zh_female_natural',
    String termbaseId = 'default',
    String domainLexiconPack = 'product',
    Duration requestTimeout = _defaultRequestTimeout,
    AccountSessionStore? accountSessionStore,
    RealtimeCreationJournal? creationJournal,
  }) : _creationJournal = creationJournal ?? FileRealtimeCreationJournal(),
       _baseUrl = baseUrl,
       _client = accountBoundClient(
         baseUrl,
         accountSessionStore ?? defaultAccountSessionStore(),
         client,
       ),
       _mode = mode,
       _sourceLanguage = sourceLanguage,
       _targetLanguage = targetLanguage,
       _autoReverseTargetLanguage = autoReverseTargetLanguage,
       _voiceOutputMode = voiceOutputMode,
       _voicePresetId = voicePresetId,
       _termbaseId = termbaseId,
       _domainLexiconPack = domainLexiconPack,
       _requestTimeout = requestTimeout,
       _accountSessionStore =
           accountSessionStore ?? defaultAccountSessionStore();

  final RealtimeCreationJournal _creationJournal;
  Future<RealtimeSession>? _creating;
  String? _creationScope;
  final Uri _baseUrl;
  final http.Client _client;
  final String _mode;
  final String _sourceLanguage;
  final String _targetLanguage;
  final bool _autoReverseTargetLanguage;
  String _voiceOutputMode;
  final String _voicePresetId;
  final String _termbaseId;
  final String _domainLexiconPack;
  final Duration _requestTimeout;
  final AccountSessionStore _accountSessionStore;

  void setVoiceOutputMode(String mode) => _voiceOutputMode = mode;

  Future<RealtimeSession> createSession() async {
    if (selfHostedAccountEnabled) {
      if (_creating != null) return _creating!;
      final running = _createBoundSession();
      _creating = running;
      try {
        return await running;
      } finally {
        if (identical(_creating, running)) _creating = null;
      }
    }
    return _postCreation(await buildCreateRequestBody());
  }

  Future<RealtimeSession> _postCreation(
    Map<String, Object?> body, {
    String? requestKey,
  }) async {
    final headers = await _authHeaders(json: true);
    if (requestKey != null) headers['idempotency-key'] = requestKey;
    final response = await _client
        .post(
          _baseUrl.resolve('/realtime/sessions'),
          headers: headers,
          body: jsonEncode(body),
        )
        .timeout(_requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (!selfHostedAccountEnabled)
        throw RealtimeApiException('Create session failed: ${response.body}');
      Object? value;
      try {
        value = jsonDecode(response.body);
      } catch (_) {}
      final code = value is Map && value['error'] is Map
          ? value['error']['code'] as String?
          : null;
      final message = switch (code) {
        'creation_session_terminal' => '上次会话已结束，请再次开始',
        'creation_request_conflict' => '上次启动仍待核对，请稍后重试',
        'service_admission_closed' => '服务暂未开放，请稍后重试',
        'auth_required' => '需要先登录账号',
        'account_not_in_test_scope' => '当前账号暂未获准使用测试服务',
        'quota_not_enough' => '可用时长不足',
        _ => '启动未完成，请稍后重试',
      };
      throw RealtimeApiException(
        message,
        statusCode: response.statusCode,
        code: code,
      );
    }

    return RealtimeSession.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<Map<String, Object?>> buildCreateRequestBody() async {
    final voice = await _voiceConfigForSession();
    return {
      'mode': _mode,
      'sourceLanguage': _sourceLanguage,
      'targetLanguage': _targetLanguage,
      if (_autoReverseTargetLanguage)
        'autoReverseTargetLanguage': _autoReverseTargetLanguage,
      'voiceOutput': voice != null,
      'speakerAttribution': const <String, Object?>{
        'mode': 'auto',
        'maxSpeakers': 4,
        'allowVoiceIdentity': true,
      },
      if (voice != null) 'voice': voice,
      if (_termbaseId.isNotEmpty) 'termbaseId': _termbaseId,
      'domainLexiconPacks': <String>[_domainLexiconPack],
    };
  }

  Future<void> saveSegments(
    String sessionId,
    List<Map<String, Object?>> segments,
  ) async {
    final response = await _client
        .post(
          _baseUrl.resolve('/sessions/$sessionId/segments'),
          headers: await _authHeaders(json: true),
          body: jsonEncode({'segments': segments}),
        )
        .timeout(_requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('Save segments failed: ${response.body}');
    }
  }

  Future<void> endSession(String sessionId) async {
    final response = await _client
        .post(
          _baseUrl.resolve('/realtime/sessions/$sessionId/end'),
          headers: await _authHeaders(),
        )
        .timeout(_requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('End session failed: ${response.body}');
    }
    await _clearBoundCreation(sessionId);
  }

  void close() {
    _client.close();
  }

  Future<void> finalizeSession({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
  }) => _finalizeRequest(
    sessionId: sessionId,
    segments: segments,
    billableSeconds: billableSeconds,
    idempotencyKey: idempotencyKey,
  );

  Future<void> finalizeWithGatewayReceipt({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
    required String gatewayReceipt,
  }) => _finalizeRequest(
    sessionId: sessionId,
    segments: segments,
    billableSeconds: billableSeconds,
    idempotencyKey: idempotencyKey,
    gatewayReceipt: gatewayReceipt,
  );

  Future<void> _finalizeRequest({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
    String? gatewayReceipt,
  }) async {
    final response = await _client
        .post(
          _baseUrl.resolve('/realtime/sessions/$sessionId/finalize'),
          headers: await _authHeaders(json: true),
          body: jsonEncode(<String, Object?>{
            'sessionId': sessionId,
            'segments': segments,
            'billableSeconds': billableSeconds,
            'idempotencyKey': idempotencyKey,
            if (gatewayReceipt != null) 'gatewayReceipt': gatewayReceipt,
          }),
        )
        .timeout(_requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException(
        'Finalize session failed: ${response.body}',
        statusCode: response.statusCode,
      );
    }
    await _clearBoundCreation(sessionId);
  }

  Future<Map<String, String>> _authHeaders({bool json = false}) {
    return accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders: json
          ? const {'content-type': 'application/json'}
          : const <String, String>{},
    );
  }

  Future<Map<String, Object?>?> _voiceConfigForSession() async {
    switch (_voiceOutputMode) {
      case 'natural':
        return {'mode': 'preset', 'presetId': _voicePresetId};
      case 'my_voice':
        return _myVoiceConfig();
      default:
        return null;
    }
  }

  Future<Map<String, Object?>> _myVoiceConfig() async {
    final response = await _client
        .get(
          _baseUrl.resolve('/voice-profiles/me'),
          headers: await _authHeaders(),
        )
        .timeout(_requestTimeout);
    final json = jsonDecode(response.body) as Map<String, Object?>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('Load My Voice failed: ${response.body}');
    }
    final profile = json['profile'];
    if (profile is! Map<String, Object?> ||
        profile['status'] != 'ready' ||
        profile['referenceAudioId'] is! String) {
      throw const RealtimeApiException('我的声音尚未准备好');
    }
    return <String, Object?>{
      'mode': profile['voiceMode'] as String? ?? 'personal_clone',
      'voiceProfileId': profile['id'],
      'referenceAudioId': profile['referenceAudioId'],
      if (profile['referenceTranscript'] is String)
        'referenceTranscript': profile['referenceTranscript'],
    };
  }
}

class RealtimeApiException implements Exception {
  const RealtimeApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => message;
}
