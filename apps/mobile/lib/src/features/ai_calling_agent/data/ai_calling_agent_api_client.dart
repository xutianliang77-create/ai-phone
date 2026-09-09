import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';
import 'ai_calling_agent_api_error.dart';
import 'ai_calling_agent_models.dart';
import 'agent_work_permission_models.dart';
import 'voice_client_ownership_models.dart';

export 'ai_calling_agent_api_error.dart';
export 'ai_calling_agent_models.dart';
export 'agent_work_permission_models.dart';
export 'voice_client_ownership_models.dart';

part 'ai_calling_agent_voice_api.dart';

class AiCallingAgentApiClient {
  AiCallingAgentApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore? accountSessionStore,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore ?? accountStoreForDeployment(baseUrl);

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

  AiCallingAgentCancellation? lastCancellation;

  Future<List<AiCallingAgentDraft>> listDrafts() async {
    final response = await _client.get(
      _baseUrl.resolve('/ai-calling-agent/drafts'),
      headers: await _authHeaders(),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException(
          'List agent drafts failed: ${response.body}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    final drafts = json['drafts'];
    if (drafts is! List) return const <AiCallingAgentDraft>[];
    return drafts
        .whereType<Map<String, Object?>>()
        .map(AiCallingAgentDraft.fromJson)
        .toList(growable: false);
  }

  Future<AiCallingAgentDraft> getDraft({required String draftId}) async {
    final response = await _client.get(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId'),
      headers: await _authHeaders(),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException(
          'Get agent draft failed: ${response.body}');
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> createDraft({
    required String scenario,
    required String objective,
    String language = 'zh',
    String? targetName,
    String? targetPhone,
    String? suggestedScript,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/ai-calling-agent/drafts'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'scenario': scenario,
        'objective': objective,
        'language': language,
        if (_hasText(targetName)) 'targetName': targetName,
        if (_hasText(targetPhone)) 'targetPhone': targetPhone,
        if (_hasText(suggestedScript)) 'suggestedScript': suggestedScript,
      }),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException(
          'Create agent draft failed: ${response.body}');
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> authorizeDraft({
    required String draftId,
    required String consentPromptVersion,
    required bool recipientDisclosureConfirmed,
    required String disclosurePromptVersion,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId/authorize'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'userConfirmed': true,
        'consentPromptVersion': consentPromptVersion,
        'recipientDisclosureConfirmed': recipientDisclosureConfirmed,
        'disclosurePromptVersion': disclosurePromptVersion,
      }),
    );
    if (!_isSuccess(response) && response.statusCode != 409) {
      throw AiCallingAgentApiException(
          'Authorize agent draft failed: ${response.body}');
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> startDraft({
    required String draftId,
    required String consentPromptVersion,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId/start'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'consentPromptVersion': consentPromptVersion}),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException.fromResponse(
        'Start agent call failed',
        response,
      );
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> requestTakeover({
    required String draftId,
    required String reason,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId/takeover'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'reason': reason}),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException(
          'Request takeover failed: ${response.body}');
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> acceptTakeover({
    required String draftId,
    required String participantIdentity,
  }) {
    return _takeoverDecision(
      draftId: draftId,
      decision: 'accept',
      participantIdentity: participantIdentity,
    );
  }

  Future<AiCallingAgentDraft> rejectTakeover({required String draftId}) {
    return _takeoverDecision(draftId: draftId, decision: 'reject');
  }

  Future<AiCallingAgentDraft> pauseDraft({required String draftId}) {
    return _setPauseState(draftId: draftId, action: 'pause');
  }

  Future<AiCallingAgentDraft> resumeDraft({required String draftId}) {
    return _setPauseState(draftId: draftId, action: 'resume');
  }

  Future<AiCallingAgentDraft> _setPauseState({
    required String draftId,
    required String action,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId/$action'),
      headers: await _authHeaders(json: true),
      body: '{}',
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException.fromResponse(
        '${action == 'pause' ? 'Pause' : 'Resume'} agent call failed',
        response,
      );
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> _takeoverDecision({
    required String draftId,
    required String decision,
    String? participantIdentity,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve(
        '/ai-calling-agent/drafts/$draftId/takeover/$decision',
      ),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        if (participantIdentity != null)
          'participantIdentity': participantIdentity,
      }),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException(
        'Takeover $decision failed: ${response.body}',
      );
    }
    return _draftFromBody(response.body);
  }

  Future<AiCallingAgentDraft> cancelDraft({
    required String draftId,
    String reason = 'user_cancelled',
  }) async {
    final response = await _client.post(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId/cancel'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'reason': reason}),
    );
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException(
          'Cancel agent draft failed: ${response.body}');
    }
    lastCancellation = parseAiCallingAgentCancellation(response.body);
    return _draftFromBody(response.body);
  }

  void close() {
    _client.close();
  }

  Future<Map<String, Object?>> _postJson(
    String path,
    Map<String, Object?> body,
    String errorPrefix,
  ) async {
    final response = await _client.post(
      _baseUrl.resolve(path),
      headers: await _authHeaders(json: true),
      body: jsonEncode(body),
    );
    return _jsonResponse(response, errorPrefix);
  }

  Map<String, Object?> _jsonResponse(
    http.Response response,
    String errorPrefix,
  ) {
    if (!_isSuccess(response)) {
      throw AiCallingAgentApiException.fromResponse(errorPrefix, response);
    }
    final value = jsonDecode(response.body);
    if (value is! Map<String, Object?>) {
      throw AiCallingAgentApiException('$errorPrefix: invalid response');
    }
    return value;
  }

  AiCallingAgentDraft _draftFromBody(String body) {
    final json = jsonDecode(body) as Map<String, Object?>;
    return AiCallingAgentDraft.fromJson(json['draft']! as Map<String, Object?>);
  }

  bool _isSuccess(http.Response response) =>
      response.statusCode >= 200 && response.statusCode < 300;

  bool _hasText(String? value) => value != null && value.trim().isNotEmpty;

  Future<Map<String, String>> _authHeaders({bool json = false}) {
    return accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders: json
          ? const {'content-type': 'application/json'}
          : const <String, String>{},
    );
  }
}
