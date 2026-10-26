import 'dart:async';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/http/account_bound_http_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_creation_journal.dart';

void main() {
  if (!selfHostedAccountEnabled) {
    test(
      'self-hosted transport matrix requires explicit account deployment defines',
      () {},
      skip:
          'Executed separately with ACCOUNT_CONTROL_BACKEND=self_hosted and pinned fixture identity',
    );
    return;
  }

  final origin = Uri.parse(configuredAccountApiBaseUrl);
  AccountSession owner() => AccountSession(
    token: 'synthetic-token',
    expiresAtIso: DateTime.now().add(const Duration(days: 1)).toIso8601String(),
    ownerId: 'a',
    deploymentId: configuredPublicDeploymentId,
    issuerOrigin: origin.origin,
  );
  http.Response identity() => http.Response(
    jsonEncode({
      'deploymentId': configuredPublicDeploymentId,
      'backend': 'self_hosted',
      'bundleId': configuredPublicBundleId,
    }),
    200,
  );
  test('uses an explicit self-hosted fixture deployment', () {
    expect(selfHostedAccountEnabled, isTrue);
    expect(configuredPublicDeploymentId, isNotEmpty);
  });
  test('pins origin and does not forward bearer across a redirect', () async {
    final requests = <http.Request>[],
        store = MemoryAccountSessionStore(owner());
    final client = AccountBoundHttpClient(
      origin,
      store,
      inner: MockClient((r) async {
        requests.add(r);
        return r.url.path == '/auth/deployment'
            ? identity()
            : http.Response(
                '',
                307,
                headers: {'location': 'https://different.invalid/steal'},
              );
      }),
    );
    final r = await client.get(
      origin.resolve('/account/me'),
      headers: {'authorization': 'Bearer synthetic-token'},
    );
    expect(r.statusCode, 307);
    expect(requests.last.followRedirects, isFalse);
    expect(requests.first.headers.containsKey('authorization'), isFalse);
    await expectLater(
      client.get(
        Uri.parse('https://different.invalid/steal'),
        headers: {'authorization': 'Bearer synthetic-token'},
      ),
      throwsFormatException,
    );
    client.close();
  });
  test(
    'logout during deployment lookup prevents authenticated dispatch',
    () async {
      final store = MemoryAccountSessionStore(owner()),
          pending = Completer<http.Response>();
      var posts = 0;
      final client = AccountBoundHttpClient(
        origin,
        store,
        inner: MockClient((r) async {
          if (r.url.path == '/auth/deployment') return pending.future;
          posts++;
          return http.Response('{}', 200);
        }),
      );
      final attempt = client.post(
        origin.resolve('/realtime/sessions'),
        headers: {'authorization': 'Bearer synthetic-token'},
        body: '{}',
      );
      await Future<void>.delayed(Duration.zero);
      await store.clear();
      pending.complete(identity());
      await expectLater(attempt, throwsA(anything));
      expect(posts, 0);
      client.close();
    },
  );
  test(
    'preserves the exact create request after lost response and never automatically retries POST',
    () async {
      final store = MemoryAccountSessionStore(owner()),
          journal = MemoryRealtimeCreationJournal(),
          keys = <String>[],
          bodies = <String>[];
      var posts = 0;
      final inner = MockClient((r) async {
        if (r.url.path == '/auth/deployment') return identity();
        expect(r.url.path, '/realtime/sessions');
        keys.add(r.headers['idempotency-key']!);
        bodies.add(r.body);
        posts++;
        if (posts == 1) throw http.ClientException('synthetic response loss');
        final sid =
            'v10-${sha256.convert(utf8.encode(jsonEncode(['a', keys.last])))}';
        return http.Response(
          jsonEncode({
            'sessionId': sid,
            'realtimeToken': 'synthetic-ticket',
            'endpoint': 'wss://${origin.host}/realtime',
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 5))
                .toIso8601String(),
            'maxDurationSeconds': 300,
          }),
          200,
        );
      });
      final api = RealtimeApiClient(
        baseUrl: origin,
        client: inner,
        accountSessionStore: store,
        creationJournal: journal,
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        voiceOutputMode: 'off',
      );
      await expectLater(api.createSession(), throwsA(anything));
      expect(posts, 1);
      expect(journal.values, hasLength(1));
      final session = await api.createSession();
      expect(session.sessionId, startsWith('v10-'));
      expect(posts, 2);
      expect(keys[0], keys[1]);
      expect(bodies[0], bodies[1]);
      expect(jsonEncode(journal.values), isNot(contains('synthetic-token')));
      expect(jsonEncode(journal.values), isNot(contains('synthetic-ticket')));
      api.close();
    },
  );
  test(
    'identity mismatch blocks content request without transmitting the account token',
    () async {
      final store = MemoryAccountSessionStore(owner());
      var calls = 0;
      final client = AccountBoundHttpClient(
        origin,
        store,
        inner: MockClient((r) async {
          calls++;
          expect(r.headers.containsKey('authorization'), isFalse);
          return http.Response(
            jsonEncode({
              'deploymentId': 'retired',
              'backend': 'cloudflare',
              'bundleId': configuredPublicBundleId,
            }),
            200,
          );
        }),
      );
      await expectLater(
        client.get(
          origin.resolve('/sessions'),
          headers: {'authorization': 'Bearer synthetic-token'},
        ),
        throwsA(anything),
      );
      expect(calls, 1);
      client.close();
    },
  );
}
