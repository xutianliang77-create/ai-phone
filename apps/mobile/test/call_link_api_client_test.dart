import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';

void main() {
  test('creates call links from API', () async {
    final client = CallLinkApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/call-links');
        expect(request.headers['authorization'], 'Bearer test-token');
        return http.Response(
          jsonEncode({
            'callId': 'call_1',
            'sessionId': 'call_1',
            'roomName': 'call_call_1',
            'roomProvider': 'livekit',
            'joinUrl': 'https://call.example.cn/join/call_1',
            'hostUrl': 'https://call.example.cn/host/call_1',
            'status': 'created',
            'expiresAt': '2026-07-02T12:00:00.000Z',
          }),
          200,
          headers: const {'content-type': 'application/json'},
        );
      }),
    );

    final link = await client.createCallLink();

    expect(link.callId, 'call_1');
    expect(link.sessionId, 'call_1');
    expect(link.roomName, 'call_call_1');
    expect(link.roomProvider, 'livekit');
    expect(link.joinUrl, 'https://call.example.cn/join/call_1');
    expect(link.status, 'created');
  });

  test('creates host room tokens from API', () async {
    final client = CallLinkApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/call-links/call_1/room-token');
        expect(request.headers['authorization'], 'Bearer test-token');
        final body = jsonDecode(request.body) as Map<String, Object?>;
        expect(body['participantRole'], 'host');
        return http.Response(
          jsonEncode({
            'callId': 'call_1',
            'provider': 'livekit',
            'roomName': 'call_call_1',
            'wsUrl': 'wss://livekit.example.cn',
            'participantRole': 'host',
            'token': 'secret-room-token',
            'expiresAt': '2026-07-02T13:00:00.000Z',
          }),
          200,
          headers: const {'content-type': 'application/json'},
        );
      }),
    );

    final token = await client.createRoomToken(callId: 'call_1');

    expect(token.provider, 'livekit');
    expect(token.roomName, 'call_call_1');
    expect(token.token, 'secret-room-token');
    expect(token.wsUrl, 'wss://livekit.example.cn');
  });

  test('ends call links from API', () async {
    final client = CallLinkApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/call-links/call_1/end');
        expect(request.headers['authorization'], 'Bearer test-token');
        return http.Response(
          jsonEncode({
            'callId': 'call_1',
            'sessionId': 'call_1',
            'status': 'ended',
            'consumedSeconds': 8,
            'endedAt': '2026-07-02T13:00:00.000Z',
          }),
          200,
          headers: const {'content-type': 'application/json'},
        );
      }),
    );

    final result = await client.endCallLink(callId: 'call_1');

    expect(result.status, 'ended');
    expect(result.sessionId, 'call_1');
    expect(result.consumedSeconds, 8);
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
