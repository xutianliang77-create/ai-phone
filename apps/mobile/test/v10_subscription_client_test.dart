import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/billing/data/on_device_subscription_client.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';
import 'package:translation_mobile/src/platform/diagnostics/subscription_load_diagnostics.dart';

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
  OnDeviceLicenseClient control({bool rejectSync = false, bool active = false, List<String>? requests}) {
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
      requests?.add(r.url.path);
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
            'entitlement': {'valid': active, 'productId': 'fixture.monthly'},
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
  test('QA offer diagnostics use StoreKit independently and never purchase or call the entitlement server', () async {
    final methods = <String>[];
    final requests = <String>[];
    final reached = Completer<void>();
    final result = Completer<Map<String, Object?>>();
    messenger.setMockMethodCallHandler(purchase, (call) {
      methods.add(call.method);
      expect(call.method, 'diagnoseOffer');
      final args = Map<String, Object?>.from(call.arguments as Map);
      expect(args['ownerId'], 'alice');
      expect(args.containsKey('appAccountToken'), isFalse);
      expect(args['diagnosticId'], matches(RegExp(r'^[a-f0-9]{32}$')));
      reached.complete();
      return result.future;
    });
    final client = OnDeviceSubscriptionClient(control: control(requests: requests), channel: purchase);
    if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') {
      await expectLater(client.diagnoseStoreOffer(), throwsStateError);
      expect(methods, isEmpty);
      expect(requests, isEmpty);
      return;
    }
    final first = client.diagnoseStoreOffer();
    await reached.future;
    expect(requests, isEmpty);
    await expectLater(client.diagnoseStoreOffer(), throwsStateError);
    expect(methods, ['diagnoseOffer']);
    await expectLater(client.load(), throwsStateError);
    expect(requests, contains('/billing/entitlement'));
    expect(methods, ['diagnoseOffer']);
    result.complete({'offerPresent': false, 'trialConfigured': false});
    await first;
    expect(methods, ['diagnoseOffer']);
  });
  test('a timed out QA offer read cannot create a duplicate while StoreKit is still running', () async {
    if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') return;
    final requests = <String>[];
    final nativeResult = Completer<Map<String, Object?>>();
    var nativeCalls = 0;
    messenger.setMockMethodCallHandler(purchase, (call) {
      expect(call.method, 'diagnoseOffer');
      nativeCalls++;
      return nativeResult.future;
    });
    final client = OnDeviceSubscriptionClient(
      control: control(requests: requests), channel: purchase,
      storeKitTimeout: const Duration(milliseconds: 20),
    );
    await expectLater(client.diagnoseStoreOffer(), throwsA(isA<TimeoutException>()));
    await expectLater(client.diagnoseStoreOffer(), throwsStateError);
    expect(nativeCalls, 1);
    expect(requests, isEmpty);
    nativeResult.complete({'offerPresent': false});
    await Future<void>.delayed(Duration.zero);
  });
  test('a QA offer result is discarded after the account scope changes', () async {
    if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') return;
    final reached = Completer<void>();
    final nativeResult = Completer<Map<String, Object?>>();
    messenger.setMockMethodCallHandler(purchase, (call) {
      expect(call.method, 'diagnoseOffer');
      reached.complete();
      return nativeResult.future;
    });
    final client = OnDeviceSubscriptionClient(control: control(), channel: purchase);
    final running = client.diagnoseStoreOffer();
    await reached.future;
    await client.control.store.clear();
    nativeResult.complete({'offerPresent': true});
    await expectLater(running, throwsA(isA<AccountAuthRequiredException>()));
  });
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
        expect(a['appAccountToken'], '11111111-1111-1111-1111-111111111111');
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

  test('an update during purchase shares the in-flight sync and finishes once', () async {
    final reached = Completer<void>();
    final purchaseResult = Completer<Map<String, Object?>>();
    final methods = <String>[];
    messenger.setMockMethodCallHandler(purchase, (c) async {
      methods.add(c.method);
      if (c.method == 'load') return product();
      if (c.method == 'purchase') {
        reached.complete();
        return purchaseResult.future;
      }
      if (c.method == 'finish') return {};
      throw StateError('unexpected ${c.method}');
    });
    final c = OnDeviceSubscriptionClient(control: control(), channel: purchase);
    final initiated = c.purchase(trialEligible: true, consent: true);
    await reached.future;
    final observed = c.recoverPending();
    await Future<void>.delayed(Duration.zero);
    purchaseResult.complete({'status': 'success', 'proofs': [
      {'transactionId': '101', 'envelope': {'clientData': 'fixture', 'deviceSignature': 'fixture'}}
    ]});
    expect(await initiated, 'success');
    expect(await observed, 'success');
    expect(methods, ['load', 'purchase', 'finish']);
  });
  test(
    'captures the StoreKit failure stage without recording its private message or details',
    () async {
      final trace = <Map<String, Object?>>[];
      messenger.setMockMethodCallHandler(purchase, (call) async {
        throw PlatformException(
          code: 'subscription_product_mismatch',
          message: 'SYNTHETIC_PRIVATE_MESSAGE',
          details: {'authorization': 'SYNTHETIC_PRIVATE_TOKEN'},
        );
      });
      final c = OnDeviceSubscriptionClient(
        control: control(),
        channel: purchase,
        diagnosticObserver: trace.add,
      );
      await expectLater(c.load(), throwsA(isA<PlatformException>()));
      expect(
        trace.any(
          (e) => e['stage'] == 'entitlement' && e['outcome'] == 'completed',
        ),
        isTrue,
      );
      expect(trace.last['stage'], 'storekit');
      expect(trace.last['outcome'], 'failed');
      expect(trace.last['errorCode'], 'subscription_product_mismatch');
      expect(jsonEncode(trace), isNot(contains('SYNTHETIC_PRIVATE')));
      expect(jsonEncode(trace), isNot(contains('fixture.monthly')));
    },
  );

  test(
    'a pending StoreKit load leaves its start stage observable without retrying',
    () async {
      final trace = <Map<String, Object?>>[];
      final reached = Completer<void>();
      final productResult = Completer<Map<String, Object?>>();
      var calls = 0;
      messenger.setMockMethodCallHandler(purchase, (call) {
        calls++;
        return productResult.future;
      });
      final c = OnDeviceSubscriptionClient(
        control: control(),
        channel: purchase,
        diagnosticObserver: (event) {
          trace.add(event);
          if (event['stage'] == 'storekit' &&
              event['outcome'] == 'started' &&
              !reached.isCompleted) {
            reached.complete();
          }
        },
      );
      final loading = c.load();
      await reached.future.timeout(const Duration(seconds: 1));
      expect(trace.last['stage'], 'storekit');
      expect(trace.last['outcome'], 'started');
      expect(calls, 1);
      productResult.complete(product());
      expect((await loading)['product'], isNotNull);
      expect(trace.last['stage'], 'complete');
      expect(calls, 1);
    },
  );

  test('timed out retries share the unfinished StoreKit request', () async {
    final result = Completer<Map<String, Object?>>();
    final trace = <Map<String,Object?>>[];
    var nativeCalls = 0;
    messenger.setMockMethodCallHandler(purchase, (_) {
      nativeCalls++;
      return result.future;
    });
    final c = OnDeviceSubscriptionClient(
      control: control(), channel: purchase,
      storeKitTimeout: const Duration(milliseconds: 20),
      diagnosticObserver: trace.add,
    );
    await expectLater(c.load(), throwsA(isA<TimeoutException>()));
    await expectLater(c.load(), throwsA(isA<TimeoutException>()));
    expect(nativeCalls, 1);
    final starts=trace.where((e)=>e['stage']=='storekit'&&e['outcome']=='started').toList();
    expect(starts.length,2);
    expect(starts[0]['requestId'],isNot(starts[1]['requestId']));
    expect(starts[0]['nativeRequestId'],starts[1]['nativeRequestId']);
    result.complete(product());
    await Future<void>.delayed(Duration.zero);
    messenger.setMockMethodCallHandler(purchase, (_) async { nativeCalls++; return product(); });
    expect((await c.load())['product'], isNotNull);
    expect(nativeCalls, 2);
  });

  test('clearing a declined approval is explicit and never purchases again', () async {
    final methods=<String>[];
    messenger.setMockMethodCallHandler(purchase, (call) async {
      methods.add(call.method);
      if (call.method=='pending') return {'status':'restored','proofs':[]};
      if (call.method=='clearPendingApproval') return {'status':'cleared'};
      throw StateError('unexpected purchase');
    });
    final c=OnDeviceSubscriptionClient(control:control(),channel:purchase);
    await expectLater(c.clearPendingApproval(userConfirmedDecline:false),throwsArgumentError);
    expect(methods,isEmpty);
    expect(await c.clearPendingApproval(userConfirmedDecline:true),'cleared');
    expect(methods,['pending','clearPendingApproval']);
    methods.clear();
    final active=OnDeviceSubscriptionClient(control:control(active:true),channel:purchase);
    await expectLater(active.clearPendingApproval(userConfirmedDecline:true),throwsStateError);
    expect(methods,['pending']);
  });

  test(
    'diagnostic observer failure never changes a successful product load',
    () async {
      messenger.setMockMethodCallHandler(purchase, (_) async => product());
      final c = OnDeviceSubscriptionClient(
        control: control(),
        channel: purchase,
        diagnosticObserver: (_) =>
            throw StateError('SYNTHETIC_DIAGNOSTIC_FAILURE'),
      );
      expect((await c.load())['product'], isNotNull);
    },
  );

  test('unknown platform errors are reduced to an allowlisted category', () {
    final event = makeSubscriptionLoadEvent(
      attempt: 1,
      stage: 'storekit',
      outcome: 'failed',
      durationMs: 4,
      error: PlatformException(
        code: 'SYNTHETIC_PRIVATE_CODE',
        message: 'SYNTHETIC_PRIVATE_MESSAGE',
      ),
    );
    expect(event['errorCode'], 'other_platform_error');
    expect(jsonEncode(event), isNot(contains('SYNTHETIC_PRIVATE')));
  });
}
