import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';

class AiCallingAgentDraft {
  const AiCallingAgentDraft({
    required this.id,
    required this.scenario,
    required this.status,
    required this.objective,
    required this.suggestedScript,
    required this.language,
    required this.riskLevel,
    required this.riskReasons,
    this.targetName,
    this.targetPhone,
    this.consentPromptVersion,
    this.authorizedAt,
    this.takeoverRequestedAt,
    this.takeoverReadyAt,
    this.takeoverResolvedAt,
    this.takeoverReason,
    this.cancelledAt,
    this.cancellationReason,
    this.callId,
    this.providerCallId,
    this.executionProvider,
    this.carrierState,
    this.liveKitParticipantState,
    this.deviceId,
    this.callGeneration,
    this.queuedAt,
    this.startedAt,
    this.completedAt,
    this.failedAt,
    this.resultSummary,
    this.failureReason,
    this.nextStep,
  });

  final String id;
  final String scenario;
  final String status;
  final String objective;
  final String suggestedScript;
  final String language;
  final String riskLevel;
  final List<String> riskReasons;
  final String? targetName;
  final String? targetPhone;
  final String? consentPromptVersion;
  final String? authorizedAt;
  final String? takeoverRequestedAt;
  final String? takeoverReadyAt;
  final String? takeoverResolvedAt;
  final String? takeoverReason;
  final String? cancelledAt;
  final String? cancellationReason;
  final String? callId;
  final String? providerCallId;
  final String? executionProvider;
  final String? carrierState;
  final String? liveKitParticipantState;
  final String? deviceId;
  final int? callGeneration;
  final String? queuedAt;
  final String? startedAt;
  final String? completedAt;
  final String? failedAt;
  final String? resultSummary;
  final String? failureReason;
  final String? nextStep;

  bool get requiresHumanTakeover =>
      status == 'requires_human_takeover' ||
      status == 'takeover_requested' ||
      riskLevel == 'requires_human_takeover';

  factory AiCallingAgentDraft.fromJson(Map<String, Object?> json) {
    return AiCallingAgentDraft(
      id: json['id']! as String,
      scenario: json['scenario']! as String,
      status: json['status']! as String,
      objective: json['objective']! as String,
      suggestedScript: json['suggestedScript']! as String,
      language: (json['language'] ?? 'zh') as String,
      riskLevel: (json['riskLevel'] ?? 'low') as String,
      riskReasons: _stringList(json['riskReasons']),
      targetName: json['targetName'] as String?,
      targetPhone: json['targetPhone'] as String?,
      consentPromptVersion: json['consentPromptVersion'] as String?,
      authorizedAt: json['authorizedAt'] as String?,
      takeoverRequestedAt: json['takeoverRequestedAt'] as String?,
      takeoverReadyAt: json['takeoverReadyAt'] as String?,
      takeoverResolvedAt: json['takeoverResolvedAt'] as String?,
      takeoverReason: json['takeoverReason'] as String?,
      cancelledAt: json['cancelledAt'] as String?,
      cancellationReason: json['cancellationReason'] as String?,
      callId: json['callId'] as String?,
      providerCallId: json['providerCallId'] as String?,
      executionProvider: json['executionProvider'] as String?,
      carrierState: json['carrierState'] as String?,
      liveKitParticipantState: json['liveKitParticipantState'] as String?,
      deviceId: json['deviceId'] as String?,
      callGeneration: json['callGeneration'] as int?,
      queuedAt: json['queuedAt'] as String?,
      startedAt: json['startedAt'] as String?,
      completedAt: json['completedAt'] as String?,
      failedAt: json['failedAt'] as String?,
      resultSummary: json['resultSummary'] as String?,
      failureReason: json['failureReason'] as String?,
      nextStep: json['nextStep'] as String?,
    );
  }

  static List<String> _stringList(Object? value) {
    if (value is! List) return const <String>[];
    return value.whereType<String>().toList(growable: false);
  }
}

class AiCallingAgentApiClient {
  AiCallingAgentApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore accountSessionStore = const FileAccountSessionStore(),
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore;

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

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
      throw AiCallingAgentApiException(
          'Start agent call failed: ${response.body}');
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
    return _draftFromBody(response.body);
  }

  void close() {
    _client.close();
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

class AiCallingAgentApiException implements Exception {
  const AiCallingAgentApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
