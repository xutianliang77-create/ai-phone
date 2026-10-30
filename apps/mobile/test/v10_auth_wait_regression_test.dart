import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_scoped_http.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

const _method = MethodChannel('fixture/auth-wait-repair');
const _events = EventChannel('fixture/auth-wait-repair-events');

AccountSession _account(String owner) => AccountSession(
  token: 'fixture-$owner',
  ownerId: owner,
  deploymentId: configuredPublicDeploymentId,
  issuerOrigin: configuredAccountApiBaseUrl,
  expiresAtIso: '2099-01-01T00:00:00Z',
);

Map<String, Object?> _deployment() => {
  'deploymentId': configuredPublicDeploymentId,
  'bundleId': configuredPublicBundleId,
  'backend': 'cloudflare',
  'execution': 'on_device',
  'controlContract': 'v10-device-license-v1',
};

Map<String, Object?> _row(String lease, int sequence) => {
  'leaseId': lease,
  'sequence': sequence,
  'envelope': {'clientData': '$lease:$sequence'},
};

http.Response _ok(Object value) => http.Response(jsonEncode(value), 200);
http.Response _conflict() => http.Response(
  jsonEncode({
    'error': {'code': 'd1_idempotency_conflict'},
  }),
  409,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  setUp(
    () => messenger.setMockMethodCallHandler(
      const MethodChannel('fixture/auth-wait-repair-events'),
      (_) async => null,
    ),
  );
  tearDown(() {
    messenger.setMockMethodCallHandler(_method, null);
    messenger.setMockMethodCallHandler(
      const MethodChannel('fixture/auth-wait-repair-events'),
      null,
    );
  });

  test(
    'new authorization proceeds while an old close remains pending',
    () async {
      final close = Completer<http.Response>();
      var configs = 0, acquisitions = 0, acknowledgements = 0;
      messenger.setMockMethodCallHandler(_method, (call) async {
        switch (call.method) {
          case 'status':
            return {
              'valid': false,
              'componentProfile': 'fixture',
              'implementationHash': 'fixture-hash',
              'devicePublicKey': 'fixture-key',
            };
          case 'outbox':
            return {
              'receipts': [_row('old', 1)],
            };
          case 'ackClose':
            acknowledgements++;
            return <String, Object?>{};
          case 'install':
            return {'valid': true, 'leaseId': 'new', 'remainingMs': 5000};
          default:
            return {'clientData': 'fixture-proof'};
        }
      });
      final client = MockClient((r) async {
        switch (r.url.path) {
          case '/auth/deployment':
            return _ok(_deployment());
          case '/v10/device/close':
            return close.future;
          case '/v10/device/configuration':
            configs++;
            return _ok({
              'execution': 'on_device',
              'licenseAdmission': 'configured_open',
              'deploymentId': configuredPublicDeploymentId,
              'serverNowMs': 1800000000000,
              'componentProfile': {'profile': 'fixture'},
              'implementationHash': 'fixture-hash',
            });
          case '/v10/device/challenge':
            return _ok({'clientData': 'fixture', 'registered': true});
          case '/v10/device/acquire':
            acquisitions++;
            return _ok({'license': 'fixture-license'});
          default:
            return _ok({});
        }
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(_account('one')),
        client: client,
        channel: _method,
        events: _events,
      );
      addTearDown(() async {
        if (!close.isCompleted) close.complete(_conflict());
        await pumpEventQueue(times: 10);
        await license.dispose();
      });
      final result = license.ensureValid();
      await pumpEventQueue(times: 30);
      expect(
        configs,
        1,
        reason: 'a stalled old receipt is not on the startup path',
      );
      expect(acquisitions, 1);
      expect((await result).valid, isTrue);
      expect(
        acknowledgements,
        0,
        reason: 'unconfirmed old receipt is retained',
      );
    },
  );

  test(
    'a 409 blocks its own lease only; a separate signed receipt progresses',
    () async {
      final sent = <String>[], acknowledged = <String>[];
      messenger.setMockMethodCallHandler(_method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': [_row('old', 1), _row('old', 2), _row('new', 1)],
          };
        }
        if (call.method == 'ackClose') {
          acknowledged.add(
            '${call.arguments['leaseId']}:${call.arguments['sequence']}',
          );
        }
        return <String, Object?>{};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') return _ok(_deployment());
        final id = (jsonDecode(r.body) as Map)['clientData'] as String;
        sent.add(id);
        if (id == 'old:1') return _conflict();
        return _ok({
          'status': 'closed',
          'leaseId': 'new',
          'sequence': 1,
          'chargedSeconds': 0,
        });
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(_account('one')),
        client: client,
        channel: _method,
        events: _events,
      );
      addTearDown(license.dispose);
      final op = await ScopedAccountOperation.capture(license.store);
      await expectLater(license.flushReceipts(op), throwsA(isA<StateError>()));
      expect(sent, ['old:1', 'new:1']);
      expect(acknowledged, ['new:1']);
    },
  );

  test(
    'same-account callers share a failed in-flight receipt without replay',
    () async {
      final response = Completer<http.Response>();
      var sent = 0;
      messenger.setMockMethodCallHandler(
        _method,
        (call) async => call.method == 'outbox'
            ? {
                'receipts': [_row('old', 1)],
              }
            : <String, Object?>{},
      );
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') return _ok(_deployment());
        sent++;
        return response.future;
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(_account('one')),
        client: client,
        channel: _method,
        events: _events,
      );
      addTearDown(() async {
        if (!response.isCompleted) response.complete(_conflict());
        await license.dispose();
      });
      final op = await ScopedAccountOperation.capture(license.store);
      final first = license.flushReceipts(op),
          second = license.flushReceipts(op);
      final both = Future.wait([
        first.then((_) => 'success', onError: (_) => 'failed'),
        second.then((_) => 'success', onError: (_) => 'failed'),
      ]);
      await pumpEventQueue(times: 20);
      expect(sent, 1);
      response.complete(_conflict());
      expect(await both, ['failed', 'failed']);
      expect(sent, 1);
    },
  );

  test(
    'an unknown 409 stops the batch instead of assuming lease isolation',
    () async {
      var sent = 0, acknowledged = 0;
      messenger.setMockMethodCallHandler(_method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': [_row('old', 1), _row('new', 1)],
          };
        }
        if (call.method == 'ackClose') acknowledged++;
        return <String, Object?>{};
      });
      final client = MockClient((r) async {
        if (r.url.path == '/auth/deployment') return _ok(_deployment());
        sent++;
        return http.Response(
          jsonEncode({
            'error': {'code': 'v10_control_unavailable'},
          }),
          409,
        );
      });
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(_account('one')),
        client: client,
        channel: _method,
        events: _events,
      );
      addTearDown(license.dispose);
      final op = await ScopedAccountOperation.capture(license.store);
      await expectLater(license.flushReceipts(op), throwsA(isA<StateError>()));
      expect(sent, 1);
      expect(acknowledged, 0);
    },
  );

  test(
    'an account switch prevents acknowledgement of the old account receipt',
    () async {
      final response = Completer<http.Response>();
      final store = MemoryAccountSessionStore(_account('one'));
      var acknowledgements = 0;
      messenger.setMockMethodCallHandler(_method, (call) async {
        if (call.method == 'outbox') {
          return {
            'receipts': [_row('old', 1)],
          };
        }
        if (call.method == 'ackClose') acknowledgements++;
        return <String, Object?>{};
      });
      final client = MockClient(
        (r) async => r.url.path == '/auth/deployment'
            ? _ok(_deployment())
            : response.future,
      );
      final license = OnDeviceLicenseClient(
        store: store,
        client: client,
        channel: _method,
        events: _events,
      );
      addTearDown(() async {
        if (!response.isCompleted) response.complete(_conflict());
        await license.dispose();
      });
      final op = await ScopedAccountOperation.capture(store);
      final pending = license
          .flushReceipts(op)
          .then((_) => 'success', onError: (_) => 'failed');
      await pumpEventQueue(times: 20);
      await store.save(_account('two'));
      response.complete(
        _ok({
          'status': 'closed',
          'leaseId': 'old',
          'sequence': 1,
          'chargedSeconds': 0,
        }),
      );
      expect(await pending, 'failed');
      expect(acknowledgements, 0);
    },
  );
}
