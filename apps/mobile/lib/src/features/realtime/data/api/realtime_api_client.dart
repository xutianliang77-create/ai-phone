import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../account/data/account_auth_headers.dart';
import '../../../account/data/account_session_store.dart';
import 'realtime_session.dart';

class RealtimeApiClient {
  RealtimeApiClient({
    required Uri baseUrl,
    http.Client? client,
    String mode = 'conversation',
    String sourceLanguage = 'auto',
    String targetLanguage = 'zh',
    bool autoReverseTargetLanguage = false,
    String voiceOutputMode = 'natural',
    String termbaseId = 'default',
    AccountSessionStore accountSessionStore = const FileAccountSessionStore(),
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _mode = mode,
        _sourceLanguage = sourceLanguage,
        _targetLanguage = targetLanguage,
        _autoReverseTargetLanguage = autoReverseTargetLanguage,
        _voiceOutputMode = voiceOutputMode,
        _termbaseId = termbaseId,
        _accountSessionStore = accountSessionStore;

  final Uri _baseUrl;
  final http.Client _client;
  final String _mode;
  final String _sourceLanguage;
  final String _targetLanguage;
  final bool _autoReverseTargetLanguage;
  final String _voiceOutputMode;
  final String _termbaseId;
  final AccountSessionStore _accountSessionStore;

  Future<RealtimeSession> createSession() async {
    final voice = await _voiceConfigForSession();
    final response = await _client.post(
      _baseUrl.resolve('/realtime/sessions'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'mode': _mode,
        'sourceLanguage': _sourceLanguage,
        'targetLanguage': _targetLanguage,
        if (_autoReverseTargetLanguage)
          'autoReverseTargetLanguage': _autoReverseTargetLanguage,
        'voiceOutput': voice != null,
        'speakerAttribution': const <String, Object?>{
          'mode': 'auto',
          'maxSpeakers': 4,
          'allowVoiceIdentity': false,
        },
        if (voice != null) 'voice': voice,
        if (_termbaseId.isNotEmpty) 'termbaseId': _termbaseId,
      }),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('Create session failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return RealtimeSession.fromJson(json);
  }

  Future<void> saveSegments(
    String sessionId,
    List<Map<String, Object?>> segments,
  ) async {
    final response = await _client.post(
      _baseUrl.resolve('/sessions/$sessionId/segments'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'segments': segments}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('Save segments failed: ${response.body}');
    }
  }

  Future<void> endSession(String sessionId) async {
    final response = await _client.post(
      _baseUrl.resolve('/realtime/sessions/$sessionId/end'),
      headers: await _authHeaders(),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('End session failed: ${response.body}');
    }
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

  Future<Map<String, Object?>?> _voiceConfigForSession() async {
    switch (_voiceOutputMode) {
      case 'natural':
        return const {'mode': 'preset'};
      case 'my_voice':
        return _myVoiceConfig();
      default:
        return null;
    }
  }

  Future<Map<String, Object?>> _myVoiceConfig() async {
    final response = await _client.get(
      _baseUrl.resolve('/voice-profiles/me'),
      headers: await _authHeaders(),
    );
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
  const RealtimeApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
