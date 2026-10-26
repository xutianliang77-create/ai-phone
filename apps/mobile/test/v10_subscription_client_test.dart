import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/billing/data/on_device_subscription_client.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const native = MethodChannel('fixture/billing-license'),
      purchase = MethodChannel('fixture/subscription'),
      events = EventChannel('fixture/billing-events');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  setUp(
    () => messenger.setMockMethodCallHandler(
      const MethodChannel('fixture/billing-events'),
      (_) async => null,
    ),
  );
  tearDown(() {
    messenger.setMockMethodCallHandler(native, null);
    messenger.setMockMethodCallHandler(purchase, null);
  });
  OnDeviceLicenseClient control({bool rejectSync = false}) {
    final store = MemoryAccountSessionStore(
      const AccountSession(
        token: 'synthetic',
        ownerId: 'alice',
        deploymentId: configuredPublicDeploymentId,
        issuerOrigin: configuredAccountApiBaseUrl,
        expiresAtIso: '2099-01-01T00:00:00Z',
      ),
    );
    messenger.setMockMethodCallHandler(
      native,
      (c) async => c.method == 'registrationProof'
          ? {'clientData': 'registration'}
          : {'devicePublicKey': 'fixture-device'},
    );
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
        case '/billing/entitlement':
          data = {
            'entitlement': {'valid': false, 'productId': 'fixture.monthly'},
            'appAccountToken': '11111111-1111-1111-1111-111111111111',
          };
        case '/v10/device/configuration':
          data = {
            'serverNowMs': 1800000000000,
            'licenseAdmission': 'configured_open',
          };
        case '/v10/device/challenge':
          data = {'clientData': 'challenge', 'registered': true};
        case '/billing/subscription/sync':
          return http.Response(
            jsonEncode(
              rejectSync
                  ? {
                      'error': {'code': 'v10_subscription_pending'},
                    }
                  : {'status': 'recorded', 'transactionId': '101'},
            ),
            rejectSync ? 503 : 200,
          );
      }
      return http.Response(jsonEncode(data), 200);
    });
    final c = OnDeviceLicenseClient(
      store: store,
      client: client,
      channel: native,
      events: events,
    );
    addTearDown(c.dispose);
    return c;
  }

  Map<String, Object?> product({
    String id = 'fixture.monthly',
    int price = 1000,
  }) => {
    'productId': id,
    'validated': true,
    'priceMinorCny': price,
    'currency': 'CNY',
    'period': 'P1M',
    'trialDays': 7,
    'trialEligible': true,
  };
  test(
    'only the matched actual CNY10 monthly product can be offered, and absence of consent invokes no purchase',
    () async {
      var calls = 0;
      messenger.setMockMethodCallHandler(purchase, (c) async {
        calls++;
        return product(price: 1200);
      });
      final c = OnDeviceSubscriptionClient(
        control: control(),
        channel: purchase,
      );
      await expectLater(c.load(), throwsStateError);
      expect(calls, 1);
      await expectLater(
        c.purchase(trialEligible: true, consent: false),
        throwsArgumentError,
      );
      expect(calls, 1);
      messenger.setMockMethodCallHandler(
        purchase,
        (_) async => product(id: 'wrong.sku'),
      );
      await expectLater(c.load(), throwsStateError);
    },
  );
  test(
    'a durable server acknowledgement precedes finish and carries the same transaction identity',
    () async {
      final methods = <String>[];
      messenger.setMockMethodCallHandler(purchase, (c) async {
        methods.add(c.method);
        final a = Map<String, Object?>.from(c.arguments as Map);
        if (c.method == 'load') return product();
        if (c.method == 'purchase') {
          expect(a['appAccountToken'], '11111111-1111-1111-1111-111111111111');
          expect(a['consentConfirmed'], true);
          return {
            'status': 'success',
            'proofs': [
              {
                'transactionId': '101',
                'envelope': {
                  'clientData': 'native-verified-transaction',
                  'deviceSignature': 'fixture-signature',
                },
              },
            ],
          };
        }
        expect(c.method, 'finish');
        expect(a['acknowledgedTransactionId'], '101');
        return {};
      });
      final c = OnDeviceSubscriptionClient(
        control: control(),
        channel: purchase,
      );
      expect(await c.purchase(trialEligible: true, consent: true), 'success');
      expect(methods, ['load', 'purchase', 'finish']);
    },
  );
  test(
    'an uncertain sync keeps the StoreKit transaction unfinished and never purchases again automatically',
    () async {
      final methods = <String>[];
      messenger.setMockMethodCallHandler(purchase, (c) async {
        methods.add(c.method);
        if (c.method == 'load') return product();
        return {
          'status': 'success',
          'proofs': [
            {
              'transactionId': '101',
              'envelope': {
                'clientData': 'native-verified-transaction',
                'deviceSignature': 'fixture-signature',
              },
            },
          ],
        };
      });
      final c = OnDeviceSubscriptionClient(
        control: control(rejectSync: true),
        channel: purchase,
      );
      await expectLater(
        c.purchase(trialEligible: true, consent: true),
        throwsStateError,
      );
      expect(methods, ['load', 'purchase']);
      expect(methods.where((m) => m == 'finish'), isEmpty);
    },
  );
}
