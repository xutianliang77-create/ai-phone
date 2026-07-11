import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';
import 'session_history_models.dart';

class SessionHistoryApiClient {
  SessionHistoryApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore accountSessionStore = const FileAccountSessionStore(),
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore;

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    final uri = _baseUrl.replace(
      path: '/sessions',
      queryParameters: query.trim().isEmpty ? null : {'q': query.trim()},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    _ensureOk(response);
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return (json['sessions']! as List<dynamic>)
        .cast<Map<String, Object?>>()
        .map(SessionListItem.fromJson)
        .toList();
  }

  Future<SessionDetail> getSession(String sessionId) async {
    final response = await _client.get(
      _baseUrl.resolve('/sessions/$sessionId'),
      headers: await _authHeaders(),
    );
    _ensureOk(response);
    return SessionDetail.fromJson(
        jsonDecode(response.body) as Map<String, Object?>);
  }

  Future<SessionDetail> saveTypeToSpeakSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
  }) {
    return saveTextTranslationSession(
      sourceText: sourceText,
      translatedText: translatedText,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      sourceKind: 'type_to_speak',
    );
  }

  Future<SessionDetail> saveTextTranslationSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
    required String sourceKind,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/sessions/text-translation'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'sourceText': sourceText,
        'translatedText': translatedText,
        'sourceLanguage': sourceLanguage,
        'targetLanguage': targetLanguage,
        'sourceKind': sourceKind,
      }),
    );
    _ensureOk(response);
    return SessionDetail.fromJson(
        jsonDecode(response.body) as Map<String, Object?>);
  }

  Future<SessionExport> exportSession(
    String sessionId, {
    String format = 'markdown',
  }) async {
    final response = await _client.get(
      _baseUrl.resolve('/sessions/$sessionId/export?format=$format'),
      headers: await _authHeaders(),
    );
    _ensureOk(response);
    return SessionExport.fromJson(
        jsonDecode(response.body) as Map<String, Object?>);
  }

  Future<SessionDetail> generateReview(String sessionId) async {
    final response = await _client.post(
      _baseUrl.resolve('/sessions/$sessionId/review'),
      headers: await _authHeaders(),
    );
    _ensureOk(response);
    return SessionDetail.fromJson(
        jsonDecode(response.body) as Map<String, Object?>);
  }

  Future<SessionDetail> renameSpeaker(
    String sessionId,
    String speakerId,
    String displayName,
  ) async {
    final response = await _client.patch(
      _baseUrl.resolve(
        '/sessions/$sessionId/speakers/${Uri.encodeComponent(speakerId)}',
      ),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'displayName': displayName}),
    );
    _ensureOk(response);
    return SessionDetail.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<TermbaseTerm> confirmTerm({
    required String sessionId,
    required String sourceText,
    required String translatedText,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/termbase/terms'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'sessionId': sessionId,
        'sourceText': sourceText,
        'translatedText': translatedText,
      }),
    );
    _ensureOk(response);
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return TermbaseTerm.fromJson(json['term']! as Map<String, Object?>);
  }

  Future<TermbaseTerm> revokeTerm(String termId) async {
    final response = await _client.delete(
      _baseUrl.resolve('/termbase/terms/$termId'),
      headers: await _authHeaders(),
    );
    _ensureOk(response);
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return TermbaseTerm.fromJson(json['term']! as Map<String, Object?>);
  }

  Future<void> deleteSession(String sessionId) async {
    final response = await _client.delete(
      _baseUrl.resolve('/sessions/$sessionId'),
      headers: await _authHeaders(),
    );
    _ensureOk(response);
  }

  void close() {
    _client.close();
  }

  void _ensureOk(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw SessionHistoryApiException(response.body);
    }
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

class SessionHistoryApiException implements Exception {
  const SessionHistoryApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
