import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_scoped_http.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

class _Events extends MockStreamHandler {
  _Events(this.stream);
  final Stream<Object?> stream;
  StreamSubscription<Object?>? subscription;
  @override
  void onListen(Object? arguments, MockStreamHandlerEventSink events) {
    subscription = stream.listen(events.success);
  }

  @override
  void onCancel(Object? arguments) {
    unawaited(subscription?.cancel());
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const method = MethodChannel('fixture/reliability-method');
  const events = EventChannel('fixture/reliability-events');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  AccountSession session() => const AccountSession(
    token: 'fixture-token',
    ownerId: 'fixture-owner',
    deploymentId: configuredPublicDeploymentId,
    issuerOrigin: configuredAccountApiBaseUrl,
    expiresAtIso: '2099-01-01T00:00:00Z',
  );
  Map<String, Object?> deployment() => {
    'deploymentId': configuredPublicDeploymentId,
    'bundleId': configuredPublicBundleId,
    'backend': 'cloudflare',
    'execution': 'on_device',
    'controlContract': 'v10-device-license-v1',
  };
  test('a clipped unchanged deadline is not renewed repeatedly', () async {
    final source = StreamController<Object?>.broadcast();
    messenger.setMockStreamHandler(events, _Events(source.stream));
    var remaining = 45000, expires = 1800000060000, renewals = 0;
    messenger.setMockMethodCallHandler(method, (call) async {
      switch (call.method) {
        case 'status':
          return {
            'valid': true,
            'leaseId': 'fixture-lease',
            'remainingMs': remaining,
            'expiresAtMs': expires,
            'componentProfile': 'fixture-v1',
            'implementationHash': 'fixture-profile',
            'devicePublicKey': 'fixture-key',
          };
        case 'outbox':
          return {'receipts': []};
        case 'registrationProof':
          return {'clientData': 'fixture-registration'};
        case 'request':
          return {
            'clientData': 'fixture-request',
            'deviceSignature': 'fixture-signature',
          };
        case 'install':
          return {
            'valid': true,
            'leaseId': 'fixture-lease',
            'remainingMs': remaining,
            'expiresAtMs': expires,
          };
        default:
          return {};
      }
    });
    final client = MockClient((r) async {
      Object body = {};
      switch (r.url.path) {
        case '/auth/deployment':
          body = deployment();
        case '/v10/device/configuration':
          body = {
            'execution': 'on_device',
            'licenseAdmission': 'configured_open',
            'componentProfile': {'profile': 'fixture-v1'},
            'implementationHash': 'fixture-profile',
            'deploymentId': configuredPublicDeploymentId,
            'serverNowMs': 1800000000000,
          };
        case '/v10/device/challenge':
          body = {'registered': true, 'clientData': 'fixture'};
        case '/v10/device/renew':
          renewals++;
          body = {'license': 'fixture-license'};
      }
      return http.Response(jsonEncode(body), 200);
    });
    final license = OnDeviceLicenseClient(
      store: MemoryAccountSessionStore(session()),
      client: client,
      channel: method,
      events: events,
    );
    addTearDown(() async {
      await source.close();
      messenger.setMockMethodCallHandler(method, null);
      messenger.setMockStreamHandler(events, null);
    });
    await license.activity('fixture-session', true);
    for (var i = 0; i < 4; i++) {
      await license.debugPollRenewal();
    }
    expect(renewals, 1);
    final op = await ScopedAccountOperation.capture(license.store);
    final renewedEntitlement = {
      'valid': true,
      'expiresAtMs': expires + 1800000,
    };
    await license.verifiedEntitlementUpdated(op, renewedEntitlement);
    await pumpEventQueue(times: 20);
    expect(renewals, 2);
    await license.verifiedEntitlementUpdated(op, renewedEntitlement);
    await pumpEventQueue(times: 20);
    expect(renewals, 2);
    remaining = 15000;
    for (var i = 0; i < 3; i++) {
      await license.debugPollRenewal();
    }
    expect(renewals, 3);
    expires += 1800000;
    remaining = 45000;
    await license.debugPollRenewal();
    expect(renewals, 4);
    await license.store.save(
      const AccountSession(
        token: 'other-token',
        ownerId: 'other-owner',
        deploymentId: configuredPublicDeploymentId,
        issuerOrigin: configuredAccountApiBaseUrl,
        expiresAtIso: '2099-01-01T00:00:00Z',
      ),
    );
    await license.verifiedEntitlementUpdated(op, {
      'valid': true,
      'expiresAtMs': expires + 3600000,
    });
    await pumpEventQueue(times: 20);
    expect(renewals, 4);
    await license.dispose();
  });
}
