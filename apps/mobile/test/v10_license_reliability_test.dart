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
  test(
    'a persisted expired receipt is sent without a foreground transition',
    () async {
      final source = StreamController<Object?>.broadcast();
      messenger.setMockStreamHandler(events, _Events(source.stream));
      var sent = 0, acknowledged = 0;
      messenger.setMockMethodCallHandler(method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': [
              {
                'leaseId': 'fixture-lease',
                'sequence': 4,
                'envelope': {'clientData': 'synthetic'},
              },
            ],
          };
        }
        if (call.method == 'ackClose') acknowledged++;
        return {};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') {
          return http.Response(jsonEncode(deployment()), 200);
        }
        if (r.url.path == '/v10/device/close') {
          sent++;
          return http.Response(
            jsonEncode({
              'status': 'closed',
              'leaseId': 'fixture-lease',
              'sequence': 4,
              'chargedSeconds': 0,
            }),
            200,
          );
        }
        return http.Response('{}', 200);
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(session()),
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(() async {
        await source.close();
        messenger.setMockStreamHandler(events, null);
        messenger.setMockMethodCallHandler(method, null);
      });
      await pumpEventQueue();
      source.add({'valid': false, 'closeReceiptQueued': true});
      await pumpEventQueue(times: 20);
      expect(sent, 1);
      expect(acknowledged, 1);
      await license.dispose();
    },
  );

  test(
    'overlapping receipt notifications do not duplicate the close request',
    () async {
      final source = StreamController<Object?>.broadcast(),
          response = Completer<http.Response>();
      messenger.setMockStreamHandler(events, _Events(source.stream));
      var sent = 0, acknowledged = 0, pending = true;
      messenger.setMockMethodCallHandler(method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': pending
                ? [
                    {
                      'leaseId': 'fixture-lease',
                      'sequence': 4,
                      'envelope': {'clientData': 'synthetic'},
                    },
                  ]
                : [],
          };
        }
        if (call.method == 'ackClose') {
          acknowledged++;
          pending = false;
        }
        return {};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') {
          return http.Response(jsonEncode(deployment()), 200);
        }
        if (r.url.path == '/v10/device/close') {
          sent++;
          return response.future;
        }
        return http.Response('{}', 200);
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(session()),
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(() async {
        await source.close();
        messenger.setMockStreamHandler(events, null);
        messenger.setMockMethodCallHandler(method, null);
      });
      await pumpEventQueue();
      source.add({'valid': false, 'closeReceiptQueued': true});
      await pumpEventQueue();
      source.add({'valid': false, 'closeReceiptQueued': true});
      await pumpEventQueue();
      expect(sent, 1);
      response.complete(
        http.Response(
          jsonEncode({
            'status': 'closed',
            'leaseId': 'fixture-lease',
            'sequence': 4,
            'chargedSeconds': 0,
          }),
          200,
        ),
      );
      await pumpEventQueue(times: 20);
      expect(sent, 1);
      expect(acknowledged, 1);
      await license.dispose();
    },
  );

  test(
    'foreground reconciliation shares the in-flight automatic close',
    () async {
      final source = StreamController<Object?>.broadcast();
      final response = Completer<http.Response>();
      messenger.setMockStreamHandler(events, _Events(source.stream));
      var sent = 0, acknowledged = 0, pending = true;
      messenger.setMockMethodCallHandler(method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': pending
                ? [
                    {
                      'leaseId': 'fixture-lease',
                      'sequence': 4,
                      'envelope': {'clientData': 'synthetic'},
                    },
                  ]
                : [],
          };
        }
        if (call.method == 'ackClose') {
          acknowledged++;
          pending = false;
        }
        return {};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') {
          return http.Response(jsonEncode(deployment()), 200);
        }
        if (r.url.path == '/v10/device/close') {
          sent++;
          return response.future;
        }
        return http.Response('{}', 200);
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(session()),
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(() async {
        await source.close();
        messenger.setMockStreamHandler(events, null);
        messenger.setMockMethodCallHandler(method, null);
      });
      await pumpEventQueue();
      source.add({'valid': false, 'closeReceiptQueued': true});
      await pumpEventQueue();
      final op = await ScopedAccountOperation.capture(license.store);
      final manual = license.flushReceipts(op);
      await pumpEventQueue();
      expect(sent, 1);
      response.complete(
        http.Response(
          jsonEncode({
            'status': 'closed',
            'leaseId': 'fixture-lease',
            'sequence': 4,
            'chargedSeconds': 0,
          }),
          200,
        ),
      );
      await manual;
      await pumpEventQueue(times: 20);
      expect(sent, 1);
      expect(acknowledged, 1);
      await license.dispose();
    },
  );

  test(
    'failed receipt delivery keeps the outbox and retries only on a later signal',
    () async {
      final source = StreamController<Object?>.broadcast();
      messenger.setMockStreamHandler(events, _Events(source.stream));
      var sent = 0, acknowledged = 0;
      messenger.setMockMethodCallHandler(method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': [
              {
                'leaseId': 'fixture-lease',
                'sequence': 4,
                'envelope': {'clientData': 'synthetic'},
              },
            ],
          };
        }
        if (call.method == 'ackClose') acknowledged++;
        return {};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') {
          return http.Response(jsonEncode(deployment()), 200);
        }
        if (r.url.path == '/v10/device/close') {
          sent++;
          if (sent == 1) throw http.ClientException('synthetic-offline');
          return http.Response(
            jsonEncode({
              'status': 'closed',
              'leaseId': 'fixture-lease',
              'sequence': 4,
              'chargedSeconds': 0,
            }),
            200,
          );
        }
        return http.Response('{}', 200);
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(session()),
        client: client,
        channel: method,
        events: events,
      );
      addTearDown(() async {
        await source.close();
        messenger.setMockStreamHandler(events, null);
        messenger.setMockMethodCallHandler(method, null);
      });
      await pumpEventQueue();
      source.add({'valid': false, 'closeReceiptQueued': true});
      await pumpEventQueue(times: 20);
      expect(sent, 1);
      expect(acknowledged, 0);
      source.add({'valid': false, 'closeReceiptQueued': true});
      await pumpEventQueue(times: 20);
      expect(sent, 2);
      expect(acknowledged, 1);
      await license.dispose();
    },
  );
}
