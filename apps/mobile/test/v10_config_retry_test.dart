import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:translation_mobile/src/features/account/data/account_scoped_http.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/http/deployment_identity_cache.dart';

AccountSession account(String owner) => AccountSession(
  token: 'fixture-$owner',
  ownerId: owner,
  deploymentId: configuredPublicDeploymentId,
  issuerOrigin: configuredAccountApiBaseUrl,
  expiresAtIso: '2099-01-01T00:00:00Z',
);

class FixtureTransport extends http.BaseClient
    implements DeploymentIdentityRetryTransport {
  FixtureTransport({
    this.failData = false,
    this.hangData = false,
    this.failIdentityFirst = false,
    this.status = 200,
  });
  final bool failData, hangData, failIdentityFirst;
  final int status;
  int sends = 0, identityCalls = 0, renewals = 0;
  final gate = Completer<void>();
  @override
  void renewIdentityConnection() => renewals++;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path == '/auth/deployment') {
      identityCalls++;
      if (identityCalls == 1 && failIdentityFirst) {
        throw TimeoutException('synthetic identity timeout');
      }
      return http.StreamedResponse(
        Stream.value(
          utf8.encode(
            jsonEncode({
              'deploymentId': configuredPublicDeploymentId,
              'bundleId': configuredPublicBundleId,
              'backend': 'cloudflare',
              'execution': 'on_device',
              'controlContract': 'v10-device-license-v1',
            }),
          ),
        ),
        200,
      );
    }
    sends++;
    if (hangData) await gate.future;
    if (failData) throw TimeoutException('synthetic data timeout');
    return http.StreamedResponse(Stream.value(utf8.encode('{}')), status);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final base = Uri.parse(configuredAccountApiBaseUrl);
  Future<http.Response> request(
    FixtureTransport client,
    MemoryAccountSessionStore store,
    String method,
    String path, {
    Duration timeout = const Duration(seconds: 3),
  }) async {
    final op = await ScopedAccountOperation.capture(store);
    return scopedAccountRequest(
      client,
      store,
      base,
      method,
      base.resolve(path),
      body: method == 'POST' ? '{}' : null,
      operation: op,
      requestTimeout: timeout,
    );
  }

  test(
    'configuration GET, entitlement GET and acquisition POST are never auto-replayed',
    () async {
      for (final pair in [
        ('GET', '/v10/device/configuration'),
        ('GET', '/billing/entitlement'),
        ('POST', '/v10/device/acquire'),
      ]) {
        final client = FixtureTransport(failData: true);
        await expectLater(
          request(
            client,
            MemoryAccountSessionStore(account('one')),
            pair.$1,
            pair.$2,
          ),
          throwsA(isA<TimeoutException>()),
        );
        expect(client.sends, 1);
        expect(client.renewals, 0);
      }
    },
  );

  test(
    'only the public identity GET retries once on a fresh connection',
    () async {
      final client = FixtureTransport(failIdentityFirst: true);
      final response = await request(
        client,
        MemoryAccountSessionStore(account('one')),
        'GET',
        '/v10/device/configuration',
        timeout: const Duration(seconds: 12),
      );
      expect(response.statusCode, 200);
      expect(client.identityCalls, 2);
      expect(client.renewals, 1);
      expect(client.sends, 1);
    },
  );

  test(
    'account switch during a failed configuration prevents any replay',
    () async {
      final store = MemoryAccountSessionStore(account('one'));
      final client = FixtureTransport(failData: true, hangData: true);
      final pending = request(
        client,
        store,
        'GET',
        '/v10/device/configuration',
      );
      final result = pending.then((_) => 'success', onError: (_) => 'failed');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await store.save(account('two'));
      client.gate.complete();
      expect(await result, 'failed');
      expect(client.sends, 1);
      expect(client.renewals, 0);
    },
  );

  test(
    'stalled configuration stops at its existing deadline without replay',
    () async {
      final client = FixtureTransport(hangData: true);
      final stopwatch = Stopwatch()..start();
      await expectLater(
        request(
          client,
          MemoryAccountSessionStore(account('one')),
          'GET',
          '/v10/device/configuration',
          timeout: const Duration(milliseconds: 180),
        ),
        throwsA(isA<TimeoutException>()),
      );
      expect(client.sends, 1);
      expect(client.renewals, 0);
      expect(stopwatch.elapsed, lessThan(const Duration(milliseconds: 500)));
      client.gate.complete();
    },
  );

  test('HTTP errors are returned once without reconnect or retry', () async {
    final client = FixtureTransport(status: 409);
    expect(
      (await request(
        client,
        MemoryAccountSessionStore(account('one')),
        'GET',
        '/v10/device/configuration',
      )).statusCode,
      409,
    );
    expect(client.sends, 1);
    expect(client.renewals, 0);
  });
}
