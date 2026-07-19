import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';

void main() {
  test('creates agent drafts from API', () async {
    final client = AiCallingAgentApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        _expectAuth(request);
        expect(request.method, 'POST');
        expect(request.url.path, '/ai-calling-agent/drafts');
        final body = jsonDecode(request.body) as Map<String, Object?>;
        expect(body['scenario'], 'booking');
        expect(body['objective'], '预约牙医复诊');
        expect(body['targetPhone'], '13800138000');
        return _jsonResponse({'draft': _draftJson()}, 201);
      }),
    );

    final draft = await client.createDraft(
      scenario: 'booking',
      objective: '预约牙医复诊',
      targetPhone: '13800138000',
    );

    expect(draft.id, 'draft_1');
    expect(draft.suggestedScript, contains('预约牙医复诊'));
    expect(draft.requiresHumanTakeover, isFalse);
  });

  test('returns high risk draft when authorization requires takeover',
      () async {
    final client = AiCallingAgentApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        _expectAuth(request);
        expect(request.method, 'POST');
        expect(request.url.path, '/ai-calling-agent/drafts/draft_1/authorize');
        final body = jsonDecode(request.body) as Map<String, Object?>;
        expect(body['userConfirmed'], isTrue);
        return _jsonResponse(
          {
            'error': {'code': 'agent_call_requires_human_takeover'},
            'draft': _draftJson(
              status: 'requires_human_takeover',
              riskLevel: 'requires_human_takeover',
              riskReasons: const <String>['payment'],
            ),
          },
          409,
        );
      }),
    );

    final draft = await client.authorizeDraft(
      draftId: 'draft_1',
      consentPromptVersion: 'domestic-ai-agent-consent-v1',
      recipientDisclosureConfirmed: true,
      disclosurePromptVersion: 'domestic-ai-agent-disclosure-v1',
    );

    expect(draft.requiresHumanTakeover, isTrue);
    expect(draft.riskReasons, contains('payment'));
  });

  test('records takeover requests', () async {
    final client = AiCallingAgentApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        _expectAuth(request);
        expect(request.method, 'POST');
        expect(request.url.path, '/ai-calling-agent/drafts/draft_1/takeover');
        return _jsonResponse(
          {
            'draft': _draftJson(
              status: 'takeover_requested',
              riskLevel: 'requires_human_takeover',
              riskReasons: const <String>['identity_verification'],
            ),
          },
          200,
        );
      }),
    );

    final draft = await client.requestTakeover(
      draftId: 'draft_1',
      reason: 'user_requested_takeover',
    );

    expect(draft.status, 'takeover_requested');
    expect(draft.requiresHumanTakeover, isTrue);
  });

  test('starts authorized agent calls', () async {
    final client = AiCallingAgentApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        _expectAuth(request);
        expect(request.method, 'POST');
        expect(request.url.path, '/ai-calling-agent/drafts/draft_1/start');
        final body = jsonDecode(request.body) as Map<String, Object?>;
        expect(body['consentPromptVersion'], 'domestic-ai-agent-consent-v1');
        return _jsonResponse(
          {
            'draft': _draftJson(
              status: 'queued',
              callId: 'call_1',
              executionProvider: 'domestic_bridge',
            ),
          },
          200,
        );
      }),
    );

    final draft = await client.startDraft(
      draftId: 'draft_1',
      consentPromptVersion: 'domestic-ai-agent-consent-v1',
    );

    expect(draft.status, 'queued');
    expect(draft.callId, 'call_1');
    expect(draft.executionProvider, 'domestic_bridge');
  });

  test('gets latest agent call status', () async {
    final client = AiCallingAgentApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        _expectAuth(request);
        expect(request.method, 'GET');
        expect(request.url.path, '/ai-calling-agent/drafts/draft_1');
        return _jsonResponse(
          {
            'draft': _draftJson(
              status: 'completed',
              callId: 'call_1',
              resultSummary: '已完成预约。',
            ),
          },
          200,
        );
      }),
    );

    final draft = await client.getDraft(draftId: 'draft_1');

    expect(draft.status, 'completed');
    expect(draft.resultSummary, '已完成预约。');
  });

  test('cancels drafts with the user cancellation reason', () async {
    final client = AiCallingAgentApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        _expectAuth(request);
        expect(request.method, 'POST');
        expect(request.url.path, '/ai-calling-agent/drafts/draft_1/cancel');
        final body = jsonDecode(request.body) as Map<String, Object?>;
        expect(body['reason'], 'user_cancelled');
        return _jsonResponse(
          {'draft': _draftJson(status: 'cancelled')},
          200,
        );
      }),
    );

    final draft = await client.cancelDraft(draftId: 'draft_1');

    expect(draft.status, 'cancelled');
  });
}

MemoryAccountSessionStore _sessionStore() {
  return MemoryAccountSessionStore(
    const AccountSession(
      token: 'test-token',
      expiresAtIso: '2026-07-07T00:00:00.000Z',
    ),
  );
}

void _expectAuth(http.BaseRequest request) {
  expect(request.headers['authorization'], 'Bearer test-token');
}

http.Response _jsonResponse(Object body, int statusCode) {
  return http.Response(
    jsonEncode(body),
    statusCode,
    headers: const {'content-type': 'application/json; charset=utf-8'},
  );
}

Map<String, Object?> _draftJson({
  String status = 'draft',
  String riskLevel = 'low',
  List<String> riskReasons = const <String>[],
  String? callId,
  String? executionProvider,
  String? resultSummary,
}) {
  return {
    'id': 'draft_1',
    'scenario': 'booking',
    'status': status,
    'objective': '预约牙医复诊',
    'suggestedScript': '您好，我想预约牙医复诊。',
    'language': 'zh',
    'riskLevel': riskLevel,
    'riskReasons': riskReasons,
    if (callId != null) 'callId': callId,
    if (executionProvider != null) 'executionProvider': executionProvider,
    if (resultSummary != null) 'resultSummary': resultSummary,
    'createdAt': '2026-07-03T00:00:00.000Z',
    'updatedAt': '2026-07-03T00:00:00.000Z',
  };
}
