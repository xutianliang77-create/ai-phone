import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_api_client.dart';

void main() {
  test('patches an account-owned action item and parses persisted state',
      () async {
    final client = SessionHistoryApiClient(
      baseUrl: Uri.parse('https://api.example.cn'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.method, 'PATCH');
        expect(request.url.path, '/sessions/session_1/action-items/0');
        expect(request.headers['authorization'], 'Bearer account-token');
        expect(jsonDecode(request.body), <String, Object?>{'completed': true});
        return http.Response(
          jsonEncode(_detailJson(completed: true)),
          200,
          headers: const {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );

    final detail = await client.updateActionItem('session_1', 0, true);

    final actions = detail.reviewJson!['actionItems'] as List<Object?>;
    expect((actions.single as Map<String, Object?>)['completed'], isTrue);
  });

  test('surfaces action item persistence failures', () async {
    final client = SessionHistoryApiClient(
      baseUrl: Uri.parse('https://api.example.cn'),
      accountSessionStore: _sessionStore(),
      client: MockClient((_) async => http.Response(
            jsonEncode(<String, Object?>{
              'error': <String, Object?>{'code': 'session_not_found'},
            }),
            404,
          )),
    );

    await expectLater(
      client.updateActionItem('missing', 0, true),
      throwsA(isA<SessionHistoryApiException>()),
    );
  });
}

MemoryAccountSessionStore _sessionStore() {
  return MemoryAccountSessionStore(const AccountSession(
    token: 'account-token',
    expiresAtIso: '2099-01-01T00:00:00.000Z',
  ));
}

Map<String, Object?> _detailJson({required bool completed}) {
  return <String, Object?>{
    'sessionId': 'session_1',
    'mode': 'meeting',
    'status': 'ended',
    'consumedSeconds': 60,
    'createdAt': '2026-07-15T10:00:00.000Z',
    'endedAt': '2026-07-15T10:01:00.000Z',
    'segmentCount': 1,
    'kind': 'realtime',
    'review': <String, Object?>{
      'summary': '会议摘要',
      'actionItems': <Object?>[
        <String, Object?>{
          'text': '发送会议纪要',
          'completed': completed,
        },
      ],
    },
    'segments': <Object?>[
      <String, Object?>{
        'id': 'segment_1',
        'sourceText': '发送会议纪要',
        'translatedText': 'Send the meeting notes',
      },
    ],
  };
}
