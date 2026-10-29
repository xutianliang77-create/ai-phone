import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_scoped_http.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/billing/data/on_device_subscription_client.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

class _RecordingLicense extends OnDeviceLicenseClient {
  _RecordingLicense({
    required super.store,
    required super.client,
    required super.channel,
    required super.events,
  });
  final received = <Object?>[];
  @override
  Future<void> verifiedEntitlementUpdated(
    ScopedAccountOperation op,
    Object? entitlement,
  ) async {
    await op.check();
    received.add(entitlement);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const native = MethodChannel('fixture/signal-native'),
      events = EventChannel('fixture/signal-events'),
      storekit = MethodChannel('fixture/signal-storekit');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  test(
    'only a recorded StoreKit proof notifies the license after native finish',
    () async {
      final order = <String>[];
      messenger.setMockMethodCallHandler(
        const MethodChannel('fixture/signal-events'),
        (_) async => null,
      );
      messenger.setMockMethodCallHandler(native, (call) async {
        if (call.method == 'readiness') {
          return {'devicePublicKey': 'fixture-key'};
        }
        if (call.method == 'registrationProof') {
          return {'clientData': 'fixture-proof'};
        }
        return {};
      });
      messenger.setMockMethodCallHandler(storekit, (call) async {
        order.add(call.method);
        if (call.method == 'pending') {
          return {
            'status': 'success',
            'proofs': [
              {
                'transactionId': '101',
                'envelope': {
                  'clientData': 'fixture',
                  'deviceSignature': 'fixture',
                },
              },
            ],
          };
        }
        return {};
      });
      final account = MemoryAccountSessionStore(
        const AccountSession(
          token: 'synthetic',
          ownerId: 'alice',
          deploymentId: configuredPublicDeploymentId,
          issuerOrigin: configuredAccountApiBaseUrl,
          expiresAtIso: '2099-01-01T00:00:00Z',
        ),
      );
      final client = MockClient((request) async {
        Object result = {};
        switch (request.url.path) {
          case '/auth/deployment':
            result = {
              'deploymentId': configuredPublicDeploymentId,
              'bundleId': configuredPublicBundleId,
              'backend': 'cloudflare',
              'execution': 'on_device',
              'controlContract': 'v10-device-license-v1',
            };
          case '/billing/entitlement':
            result = {
              'entitlement': {'valid': true},
              'appAccountToken': '11111111-1111-1111-1111-111111111111',
            };
          case '/v10/device/configuration':
            result = {'serverNowMs': 1800000000000};
          case '/v10/device/challenge':
            result = {'registered': true, 'clientData': 'fixture'};
          case '/billing/subscription/sync':
            order.add('server_ack');
            result = {
              'status': 'recorded',
              'transactionId': '101',
              'entitlement': {'valid': true, 'expiresAtMs': 1800001800000},
            };
        }
        return http.Response(jsonEncode(result), 200);
      });
      final control = _RecordingLicense(
        store: account,
        client: client,
        channel: native,
        events: events,
      );
      addTearDown(() async {
        await control.dispose();
        messenger.setMockMethodCallHandler(native, null);
        messenger.setMockMethodCallHandler(storekit, null);
        messenger.setMockMethodCallHandler(
          const MethodChannel('fixture/signal-events'),
          null,
        );
      });
      final billing = OnDeviceSubscriptionClient(
        control: control,
        channel: storekit,
      );
      expect(await billing.recoverPending(), 'success');
      expect(order, ['pending', 'server_ack', 'finish']);
      expect(control.received, [
        {'valid': true, 'expiresAtMs': 1800001800000},
      ]);
    },
  );
}
