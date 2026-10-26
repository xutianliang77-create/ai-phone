import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const method = MethodChannel('fixture/v10-license'),
      events = EventChannel('fixture/v10-license-events');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  setUp(
    () => messenger.setMockMethodCallHandler(
      const MethodChannel('fixture/v10-license-events'),
      (_) async => null,
    ),
  );
  tearDown(() => messenger.setMockMethodCallHandler(method, null));
  AccountSession session(String owner) => AccountSession(
    token: 'fixture-$owner',
    ownerId: owner,
    deploymentId: configuredPublicDeploymentId,
    issuerOrigin: configuredAccountApiBaseUrl,
    expiresAtIso: '2099-01-01T00:00:00Z',
  );
  test(
    'a lost POST resolves its original request and cannot reset its native request clock',
    () async {
      var valid = false, requests = 0, posts = 0, resolves = 0;
      final store = MemoryAccountSessionStore(session('alice'));
      messenger.setMockMethodCallHandler(method, (c) async {
        switch (c.method) {
          case 'status':
            return {
              'valid': valid,
              'implementationHash': 'fixture-profile',
              'devicePublicKey': 'fixture-key',
              'remainingMs': 50000,
            };
          case 'registrationProof':
            return {'clientData': 'registration'};
          case 'request':
            requests++;
            return {
              'clientData': 'one-immutable-request',
              'deviceSignature': 'one-signature',
            };
          case 'install':
            expect((c.arguments as Map)['license'], 'original-token');
            valid = true;
            return {'valid': true, 'leaseId': 'one', 'remainingMs': 49000};
          case 'outbox':
            return {'receipts': []};
          default:
            return {};
        }
      });
      final client = MockClient((r) async {
        Object data = {};
        switch (r.url.path) {
          case '/auth/deployment':
            data = {
              'deploymentId': configuredPublicDeploymentId,
              'bundleId': configuredPublicBundleId,
              'backend': 'cloudflare',
              'execution': 'on_device',
              'controlContract': 'v10-device-license-v1',
            };
          case '/v10/device/configuration':
            data = {
              'execution': 'on_device',
              'licenseAdmission': 'configured_open',
              'implementationHash': 'fixture-profile',
              'deploymentId': configuredPublicDeploymentId,
              'serverNowMs': 1800000000000,
            };
          case '/v10/device/challenge':
            data = {'registered': true, 'clientData': 'fixture'};
          case '/v10/device/acquire':
            posts++;
            throw http.ClientException('synthetic response lost');
          case '/v10/device/resolve':
            resolves++;
            expect(jsonDecode(r.body)['clientData'], 'one-immutable-request');
            data = {'status': 'issued', 'license': 'original-token'};
        }
        return http.Response(jsonEncode(data), 200);
      });
      final license = OnDeviceLicenseClient(
        store: store,
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(license.dispose);
      await expectLater(
        license.ensureValid(),
        throwsA(isA<http.ClientException>()),
      );
      expect((await license.ensureValid()).valid, true);
      expect(requests, 1);
      expect(posts, 1);
      expect(resolves, 1);
      expect((await license.ensureValid()).valid, true);
      expect(posts, 1);
    },
  );
  test(
    'statistics outbox failure cannot block a verified membership license',
    () async {
      var acquired = 0, outboxReads = 0;
      final store = MemoryAccountSessionStore(session('alice'));
      messenger.setMockMethodCallHandler(method, (c) async {
        if (c.method == 'outbox') {
          outboxReads++;
          throw PlatformException(code: 'synthetic_statistics_unavailable');
        }
        if (c.method == 'install') {
          return {'valid': true, 'leaseId': 'new', 'remainingMs': 10000};
        }
        if (c.method == 'status') {
          return {'valid': false, 'implementationHash': 'fixture-profile'};
        }
        return {'clientData': 'synthetic-device-proof'};
      });
      final client = MockClient((r) async {
        Object body = {};
        if (r.url.path == '/auth/deployment') {
          body = {
            'deploymentId': configuredPublicDeploymentId,
            'bundleId': configuredPublicBundleId,
            'backend': 'cloudflare',
            'execution': 'on_device',
            'controlContract': 'v10-device-license-v1',
          };
        }
        if (r.url.path == '/v10/device/configuration') {
          body = {
            'execution': 'on_device',
            'licenseAdmission': 'configured_open',
            'implementationHash': 'fixture-profile',
            'deploymentId': configuredPublicDeploymentId,
            'serverNowMs': 1800000000000,
          };
        }
        if (r.url.path == '/v10/device/acquire') {
          acquired++;
          body = {'license': 'synthetic-grant'};
        }
        return http.Response(jsonEncode(body), 200);
      });
      final license = OnDeviceLicenseClient(
        store: store,
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(license.dispose);
      expect((await license.ensureValid()).valid, true);
      expect(outboxReads, 1);
      expect(acquired, 1);
    },
  );
  test(
    'an owner change during metadata lookup cannot install a stale license',
    () async {
      var installs = 0;
      final store = MemoryAccountSessionStore(session('alice'));
      messenger.setMockMethodCallHandler(method, (c) async {
        if (c.method == 'install') installs++;
        return {'valid': false, 'implementationHash': 'x'};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') {
          return http.Response(
            jsonEncode({
              'deploymentId': configuredPublicDeploymentId,
              'bundleId': configuredPublicBundleId,
              'backend': 'cloudflare',
              'execution': 'on_device',
              'controlContract': 'v10-device-license-v1',
            }),
            200,
          );
        }
        await store.save(session('bob'));
        return http.Response('{}', 200);
      });
      final license = OnDeviceLicenseClient(
        store: store,
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(license.dispose);
      await expectLater(license.ensureValid(), throwsA(anything));
      expect(installs, 0);
    },
  );
}
