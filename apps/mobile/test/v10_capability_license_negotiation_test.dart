import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('fixture/capability-license');
  const events = EventChannel('fixture/capability-events');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const session = AccountSession(
    token: 'fixture',
    ownerId: 'alice',
    deploymentId: configuredPublicDeploymentId,
    issuerOrigin: configuredAccountApiBaseUrl,
    expiresAtIso: '2099-01-01T00:00:00Z',
  );
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));
  Future<(OnDeviceLicenseClient, List<String>)> fixture({
    required bool hashMatches,
  }) async {
    final paths = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'status') {
        return {
          'valid': false,
          'componentProfile': 'candidate-r2',
          'implementationHash': 'candidate-hash',
          'devicePublicKey': 'fixture',
        };
      }
      if (call.method == 'install') {
        return {
          'valid': true,
          'leaseId': 'fixture-lease',
          'remainingMs': 12000,
        };
      }
      if (call.method == 'outbox') return {'receipts': []};
      return {'clientData': 'fixture-proof'};
    });
    final client = MockClient((request) async {
      paths.add(request.url.path);
      Object value = {};
      if (request.url.path == '/auth/deployment') {
        value = {
          'deploymentId': configuredPublicDeploymentId,
          'bundleId': configuredPublicBundleId,
          'backend': 'cloudflare',
          'execution': 'on_device',
          'controlContract': 'v10-device-license-v1',
        };
      }
      if (request.url.path == '/v10/device/configuration') {
        value = {
          'execution': 'on_device',
          'deploymentId': configuredPublicDeploymentId,
          'licenseAdmission': 'configured_open',
          'serverNowMs': 1800000000000,
          'componentProfile': {'profile': 'old-r1'},
          'implementationHash': 'old-hash',
          'availableProfiles': [
            {
              'componentProfile': {'profile': 'candidate-r2'},
              'implementationHash': hashMatches
                  ? 'candidate-hash'
                  : 'different-hash',
            },
          ],
        };
      }
      if (request.url.path == '/v10/device/challenge') {
        value = {'clientData': 'fixture', 'registered': true};
      }
      if (request.url.path == '/v10/device/acquire') {
        value = {'license': 'fixture-signed-token'};
      }
      return http.Response(jsonEncode(value), 200);
    });
    return (
      OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(session),
        client: client,
        channel: channel,
        events: events,
      ),
      paths,
    );
  }

  test(
    'a specifically advertised matching capability contract can proceed',
    () async {
      final (client, paths) = await fixture(hashMatches: true);
      addTearDown(client.dispose);
      expect((await client.ensureValid()).valid, true);
      expect(paths, contains('/v10/device/acquire'));
    },
  );
  test(
    'wrong contract fingerprint stops before registration or acquisition',
    () async {
      final (client, paths) = await fixture(hashMatches: false);
      addTearDown(client.dispose);
      await expectLater(client.ensureValid(), throwsA(isA<StateError>()));
      expect(paths, isNot(contains('/v10/device/challenge')));
      expect(paths, isNot(contains('/v10/device/acquire')));
    },
  );
}
