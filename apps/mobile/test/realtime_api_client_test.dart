import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';

void main() {
  test('creates sessions with configured translation direction', () async {
    Map<String, Object?>? requestBody;
    final api = RealtimeApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      mode: 'meeting',
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      voiceOutputMode: 'natural',
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer test-token');
        requestBody = jsonDecode(request.body) as Map<String, Object?>;
        return http.Response(
          jsonEncode({
            'sessionId': 'sess_1',
            'realtimeToken': 'token',
            'endpoint': 'ws://127.0.0.1:3101/realtime',
            'expiresAt': DateTime.now().toIso8601String(),
            'maxDurationSeconds': 60,
          }),
          200,
          headers: const {'content-type': 'application/json'},
        );
      }),
    );

    await api.createSession();

    expect(requestBody?['sourceLanguage'], 'auto');
    expect(requestBody?['targetLanguage'], 'en');
    expect(requestBody?['mode'], 'meeting');
    expect(requestBody?['voiceOutput'], isTrue);
    expect(requestBody?['voice'], {'mode': 'preset'});
    expect(requestBody?['termbaseId'], 'default');
    expect(requestBody?['speakerAttribution'], {
      'mode': 'auto',
      'maxSpeakers': 4,
      'allowVoiceIdentity': false,
    });
  });

  test('creates sessions with ready My Voice config', () async {
    final requests = <String, Map<String, Object?>?>{};
    final api = RealtimeApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      voiceOutputMode: 'my_voice',
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        if (request.url.path == '/voice-profiles/me') {
          return http.Response(
            jsonEncode({
              'profile': {
                'id': 'voice_1',
                'status': 'ready',
                'voiceMode': 'ultimate_clone',
                'referenceAudioId': 'voice_1',
                'referenceTranscript': '你好，我正在创建我的声音。',
              },
            }),
            200,
            headers: const {'content-type': 'application/json; charset=utf-8'},
          );
        }
        requests[request.url.path] =
            jsonDecode(request.body) as Map<String, Object?>;
        return http.Response(
          jsonEncode({
            'sessionId': 'sess_1',
            'realtimeToken': 'token',
            'endpoint': 'ws://127.0.0.1:3101/realtime',
            'expiresAt': DateTime.now().toIso8601String(),
            'maxDurationSeconds': 60,
          }),
          200,
        );
      }),
    );

    await api.createSession();

    expect(requests['/realtime/sessions']?['voice'], {
      'mode': 'ultimate_clone',
      'voiceProfileId': 'voice_1',
      'referenceAudioId': 'voice_1',
      'referenceTranscript': '你好，我正在创建我的声音。',
    });
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
