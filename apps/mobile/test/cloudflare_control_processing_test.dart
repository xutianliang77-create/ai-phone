import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/billing/data/billing_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/shared_control_processing_api.dart';
import 'package:translation_mobile/src/features/realtime/data/api/shared_control_request_journal.dart';
import 'package:translation_mobile/src/features/realtime/data/api/shared_control_proof_client.dart';

class Proof extends SharedControlProofClient {
  Proof() : super(ownerId: 'owner');
  @override
  Future<Map<String, Object?>> identity() async => {
    'devicePublicKey': 'synthetic-key',
  };
  @override
  Future<Map<String, Object?>> register(Map<String, Object?> c) async => {
    'registered': true,
  };
  @override
  Future<Map<String, Object?>> signIssue(Map<String, Object?> b) async => {
    'clientData': base64Encode(utf8.encode(jsonEncode(b))),
    'deviceSignature': 'synthetic-not-real',
  };
}

void main() {
  if (configuredAccountBackend != 'cloudflare') {
    test(
      'separate Cloudflare fixture matrix',
      () {},
      skip: 'Run with pinned cloudflare control and processing defines',
    );
    return;
  }
  final control = Uri.parse(configuredAccountApiBaseUrl),
      processing = Uri.parse(configuredProcessingApiBaseUrl);
  AccountSession session() => AccountSession(
    token: 'synthetic-user',
    ownerId: 'owner',
    deploymentId: configuredPublicDeploymentId,
    issuerOrigin: control.origin,
    expiresAtIso: DateTime.now().add(const Duration(days: 1)).toIso8601String(),
  );
  http.Response json(Object b, int status) => http.Response(
    jsonEncode(b),
    status,
    headers: {'content-type': 'application/json'},
  );
  test(
    'billing DTO remains compatible with the independent zero-credit account',
    () {
      final b = UsageBalance.fromJson({
        'planCode': 'public_prepaid',
        'subscribed': false,
        'monthlySeconds': 0,
        'remainingSeconds': 0,
        'availableSeconds': 0,
        'heldSeconds': 0,
      });
      expect(b.remainingSeconds, 0);
      expect(b.subscribed, false);
    },
  );
  test(
    'uncertain create is explicitly retried with the identical device-bound request and no extra key',
    () async {
      final store = MemoryAccountSessionStore(session()),
          journal = MemorySharedControlRequestJournal();
      final creates = <String>[], resolutions = <String>[];
      var failFirst = true;
      final inner = MockClient((r) async {
        if (r.url.path == '/auth/deployment') {
          return json({
            'deploymentId': configuredPublicDeploymentId,
            'backend': 'cloudflare',
            'bundleId': configuredPublicBundleId,
            'processingApiBaseUrl': processing.toString(),
          }, 200);
        }
        expect(r.headers['authorization'], 'Bearer synthetic-user');
        switch (r.url.path) {
          case '/v10/control/configuration':
            return json({
              'execution': 'retained_v10_processing',
              'processingApiBaseUrl': processing.toString(),
              'planHash': 'a' * 64,
            }, 200);
          case '/v10/control/devices/challenge':
            return json({'clientData': 'fixture', 'registered': true}, 200);
          case '/v10/control/devices/register':
            return json({'status': 'registered'}, 200);
          case '/v10/control/requests/resolve':
            resolutions.add(r.body);
            return json({
              'status': 'prepared',
              'sessionId': 'fixture-session',
            }, 200);
          case '/realtime/sessions':
            expect(r.url.origin, processing.origin);
            creates.add(r.body);
            if (failFirst) {
              failFirst = false;
              throw http.ClientException('response lost');
            }
            return json({
              'sessionId': 'fixture-session',
              'realtimeToken': 'synthetic-ticket',
              'endpoint': 'wss://${processing.host}/realtime',
              'expiresAt': DateTime.now()
                  .add(const Duration(minutes: 5))
                  .toIso8601String(),
              'maxDurationSeconds': 100,
              'controlBinding': {
                'ownerId': 'owner',
                'deploymentId': configuredPublicDeploymentId,
                'execution': 'retained_v10_processing',
              },
            }, 200);
        }
        throw StateError('Unexpected fixture request ${r.url.path}');
      });
      final api = SharedControlProcessingApiClient(
        processingBase: processing,
        controlBase: control,
        store: store,
        mode: 'conversation',
        source: 'zh',
        target: 'en',
        autoReverse: false,
        voiceMode: 'off',
        voicePreset: 'zh_female_natural',
        lexicon: 'product',
        processingClient: inner,
        controlClient: inner,
        journal: journal,
        proofFactory: (_) => Proof(),
      );
      await expectLater(api.createSession(), throwsA(isA<Exception>()));
      expect(creates.length, 1);
      await api.createSession();
      expect(creates.length, 2);
      expect(creates[0], creates[1]);
      expect(resolutions.length, 1);
      expect(jsonEncode(journal.values), isNot(contains('synthetic-user')));
      api.close();
    },
  );
}
