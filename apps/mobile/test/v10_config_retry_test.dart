import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cupertino_http/cupertino_http.dart' show NSErrorClientException;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:objective_c/objective_c.dart' as objc;
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
    this.failFirst = false,
    this.hangFirst = false,
    this.status = 200,
    this.firstError,
  });
  final bool failFirst, hangFirst;
  final int status;
  final Object? firstError;
  int sends = 0, renewals = 0;
  final gate = Completer<void>();
  @override
  void renewIdentityConnection() => renewals++;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path == '/auth/deployment') {
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
    if (sends == 1 && hangFirst) await gate.future;
    if (sends == 1 && firstError != null) throw firstError!;
    if (sends == 1 && failFirst) {
      throw TimeoutException('synthetic transport failure');
    }
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
    'only configuration GET renews the session and retries one transport failure',
    () async {
      final store = MemoryAccountSessionStore(account('one'));
      final client = FixtureTransport(failFirst: true);
      final response = await request(
        client,
        store,
        'GET',
        '/v10/device/configuration',
      );
      expect(response.statusCode, 200);
      expect(client.sends, 2);
      expect(client.renewals, 1);
    },
  );

  test(
    'entitlement GET and acquisition POST are never automatically replayed',
    () async {
      for (final pair in [
        ('GET', '/billing/entitlement'),
        ('POST', '/v10/device/acquire'),
      ]) {
        final client = FixtureTransport(failFirst: true);
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

  test('account change during a failed attempt prevents retry', () async {
    final store = MemoryAccountSessionStore(account('one'));
    final client = FixtureTransport(failFirst: true, hangFirst: true);
    final pending = request(client, store, 'GET', '/v10/device/configuration');
    final result = pending.then((_) => 'success', onError: (_) => 'failed');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await store.save(account('two'));
    client.gate.complete();
    expect(await result, 'failed');
    expect(client.sends, 1);
    expect(client.renewals, 0);
  });

  test('a stalled first configuration attempt leaves time for retry', () async {
    final client = FixtureTransport(hangFirst: true);
    final stopwatch = Stopwatch()..start();
    final response = await request(
      client,
      MemoryAccountSessionStore(account('one')),
      'GET',
      '/v10/device/configuration',
      timeout: const Duration(milliseconds: 300),
    );
    expect(response.statusCode, 200);
    expect(client.sends, 2);
    expect(client.renewals, 1);
    expect(stopwatch.elapsed, lessThan(const Duration(milliseconds: 500)));
    client.gate.complete();
  });

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

  test(
    'TLS failures are not retried; transient connection loss may retry',
    () async {
      NSErrorClientException error(int code) => NSErrorClientException(
        objc.NSError.errorWithDomain(
          'NSURLErrorDomain'.toNSString(),
          code: code,
        ),
      );
      final tls = FixtureTransport(firstError: error(-1202));
      await expectLater(
        request(
          tls,
          MemoryAccountSessionStore(account('one')),
          'GET',
          '/v10/device/configuration',
        ),
        throwsA(isA<NSErrorClientException>()),
      );
      expect(tls.sends, 1);
      expect(tls.renewals, 0);
      final lost = FixtureTransport(firstError: error(-1005));
      expect(
        (await request(
          lost,
          MemoryAccountSessionStore(account('one')),
          'GET',
          '/v10/device/configuration',
        )).statusCode,
        200,
      );
      expect(lost.sends, 2);
      expect(lost.renewals, 1);
    },
    skip: !Platform.isMacOS,
  );
}
