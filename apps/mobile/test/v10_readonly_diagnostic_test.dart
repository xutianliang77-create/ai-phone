import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/control_diagnostic_page.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/main_shell_page.dart';
import 'package:translation_mobile/src/platform/diagnostics/control_diagnostic_policy.dart';
import 'package:translation_mobile/src/platform/http/on_device_egress.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('diagnostic build permits only public identity GET', () async {
    expect(controlDiagnosticReadOnly, isTrue);
    final base = Uri.parse(configuredAccountApiBaseUrl);
    for (final path in ['/auth/deployment']) {
      expect(
        () => requireOnDeviceControlRequest(
          base,
          'GET',
          base.resolve(path),
          null,
        ),
        returnsNormally,
      );
    }
    for (final pair in [
      ('POST', '/v10/device/close'),
      ('POST', '/v10/device/acquire'),
      ('POST', '/billing/subscription/sync'),
      ('GET', '/billing/entitlement'),
      ('GET', '/v10/device/configuration'),
      ('POST', '/auth/apple/login'),
    ]) {
      expect(
        () => requireOnDeviceControlRequest(
          base,
          pair.$1,
          base.resolve(pair.$2),
          null,
        ),
        throwsA(isA<StateError>()),
      );
    }
  });

  test(
    'diagnostic probe makes no receipt, entitlement or acquisition request',
    () async {
      const channel = MethodChannel('fixture/read-only-diagnostic');
      const events = EventChannel('fixture/read-only-diagnostic-events');
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      var nativeCalls = 0;
      messenger.setMockMethodCallHandler(channel, (_) async {
        nativeCalls++;
        return {};
      });
      messenger.setMockMethodCallHandler(
        const MethodChannel('fixture/read-only-diagnostic-events'),
        (_) async => null,
      );
      final paths = <String>[];
      final diagnosticIds = <String?>[];
      final authorizations = <String?>[];
      final client = MockClient((request) async {
        paths.add(request.url.path);
        diagnosticIds.add(request.headers['x-wujie-diagnostic-id']);
        authorizations.add(request.headers['authorization']);
        final value = request.url.path == '/auth/deployment'
            ? {
                'deploymentId': configuredPublicDeploymentId,
                'bundleId': configuredPublicBundleId,
                'backend': 'cloudflare',
                'execution': 'on_device',
                'controlContract': 'v10-device-license-v1',
              }
            : {'licenseAdmission': 'closed'};
        return http.Response(jsonEncode(value), 200);
      });
      const session = AccountSession(
        token: 'fixture',
        ownerId: 'fixture',
        deploymentId: configuredPublicDeploymentId,
        issuerOrigin: configuredAccountApiBaseUrl,
        expiresAtIso: '2099-01-01T00:00:00Z',
      );
      final license = OnDeviceLicenseClient(
        store: MemoryAccountSessionStore(session),
        client: client,
        channel: channel,
        events: events,
      );
      addTearDown(() async {
        await license.dispose();
        messenger.setMockMethodCallHandler(channel, null);
        messenger.setMockMethodCallHandler(
          const MethodChannel('fixture/read-only-diagnostic-events'),
          null,
        );
      });
      await license.reconcileOnline();
      await expectLater(license.ensureValid(), throwsA(isA<StateError>()));
      await expectLater(
        license.request('/v10/device/configuration'),
        throwsA(isA<StateError>()),
      );
      expect(
        (await runPublicControlDiagnostic(client: client))['identityVerified'],
        true,
      );
      expect(paths, ['/auth/deployment']);
      expect(diagnosticIds, everyElement(matches(RegExp(r'^[a-f0-9]{24}$'))));
      expect(authorizations, [null]);
      expect(nativeCalls, 0);
    },
  );

  testWidgets('probe waits for an explicit tap and performs it once', (
    tester,
  ) async {
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ControlDiagnosticPage(
          probe: () async {
            calls++;
            return {'identityVerified': true};
          },
        ),
      ),
    );
    expect(calls, 0);
    await tester.tap(find.text('检查一次'));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('服务身份已验证；未领取授权。'), findsOneWidget);
  });

  testWidgets(
    'read-only diagnostic build opens its isolated screen without the normal tabs',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: MainShellPage()));
      await tester.pump();
      expect(find.text('授权连接诊断'), findsOneWidget);
      expect(find.text('检查一次'), findsOneWidget);
      expect(find.text('订阅与试用'), findsNothing);
    },
  );
}
