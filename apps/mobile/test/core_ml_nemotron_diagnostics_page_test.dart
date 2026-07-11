import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/api_health_client.dart';

import 'helpers/core_ml_nemotron_diagnostics_test_helpers.dart';

void main() {
  testWidgets('opens Core ML Nemotron diagnostics',
      (WidgetTester tester) async {
    const channel = MethodChannel('translation_mobile/core_ml_nemotron_asr');
    Map<dynamic, dynamic>? prepareArguments;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (call) async {
        if (call.method == 'isAvailable') {
          return <String, Object?>{
            'reason': 'model_not_found',
            'localModelReady': false,
            'decoderReady': false,
            'fluidAudio': <String, Object?>{'runtimeAvailable': true},
            'audio': <String, Object?>{'running': false},
          };
        }
        if (call.method == 'prepare') {
          prepareArguments = call.arguments as Map<dynamic, dynamic>;
          return null;
        }
        return <String, Object?>{};
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      );
    });

    await tester.pumpWidget(TranslationApp(
      complianceConsentStore: MemoryComplianceConsentStore.accepted(),
    ));
    await tester.pump();
    await tester.tap(find.byTooltip('模型链路诊断').first);
    await tester.pumpAndSettle();

    expect(find.text('模型链路诊断'), findsOneWidget);
    expect(find.text('可用性'), findsOneWidget);
    expect(find.text('模型未找到'), findsWidgets);
    expect(find.text('未找到 Nemotron Core ML 模型'), findsOneWidget);

    await tester.tap(find.text('允许下载模型'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('准备模型'));
    await tester.pumpAndSettle();

    expect(prepareArguments?['autoDownloadModel'], isTrue);
  });

  testWidgets('runs Core ML Nemotron microphone self-test',
      (WidgetTester tester) async {
    final provider = FakeMobileAsrProvider();
    final shareService = FakeFileShareService();
    addTearDown(provider.dispose);

    await tester.pumpWidget(diagnosticsTestApp(
      provider: provider,
      shareService: shareService,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('开始自测'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    expect(
      provider.calls,
      containsAll(<String>['requestPermission', 'prepare', 'start']),
    );
    await tester.scrollUntilVisible(
      find.text('hello from device self test', findRichText: true),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text('hello from device self test', findRichText: true),
      findsOneWidget,
    );

    await tester.drag(find.byType(Scrollable).first, const Offset(0, 1000));
    await tester.pump();
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 1000));
    await tester.pump();
    expect(find.text('导出诊断'), findsOneWidget);
    final exportButton = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, '导出诊断'),
    );
    expect(exportButton.onPressed, isNotNull);
    exportButton.onPressed!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(shareService.sharedPath, isNotNull);
    expect(shareService.mimeType, 'application/json');
    expect(shareService.filename, startsWith('coreml-nemotron-diagnostics-'));
    final report =
        jsonDecode(utf8.decode(shareService.bytes!)) as Map<String, Object?>;
    expect(report['provider'], 'coreml_nemotron');
    expect((report['availability']! as Map)['reason'], 'ready');
    final serviceConnection = report['serviceConnection']! as Map;
    expect(serviceConnection['apiBaseUrl'], 'http://127.0.0.1:3100');
    expect(serviceConnection['apiBaseUrlLocalOnly'], isTrue);
    final selfTest = report['selfTest']! as Map<String, Object?>;
    final audioDiagnostic = selfTest['audioDiagnostic']! as Map;
    expect(audioDiagnostic['status'], 'ok');
    final segments = selfTest['segments']! as List<dynamic>;
    final segment = segments.single as Map;
    expect(segment['textCharCount'], 27);
    expect(segment.containsKey('text'), isFalse);

    await tester.drag(find.byType(Scrollable).first, const Offset(0, 600));
    await tester.pump();
    await tester.tap(find.text('停止自测'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(provider.calls, contains('stop'));
  });

  testWidgets('checks API service health from diagnostics',
      (WidgetTester tester) async {
    final provider = FakeMobileAsrProvider();
    final shareService = FakeFileShareService();
    addTearDown(provider.dispose);

    await tester.pumpWidget(diagnosticsTestApp(
      provider: provider,
      shareService: shareService,
      config: diagnosticsConfig(
        apiBaseUrl: Uri.parse('http://192.168.2.10:3100'),
      ),
      apiHealthFetcher: (_) async => const ApiHealthInfo(
        status: 'ok',
        service: 'api-server',
        version: '0.1.0',
        realtimeWsEndpoint: 'ws://192.168.2.10:3201/realtime',
        regionEdition: 'domestic',
        dataRegion: 'cn',
        callProviderPolicy: 'call_link_only',
        complianceProfile: 'pipl',
      ),
      gatewayHealthFetcher: (_) async => const GatewayHealthInfo(
        status: 'ok',
        service: 'realtime-gateway',
        provider: 'qwen_live',
        resolvedProvider: 'lmstudio',
        asrProvider: 'http',
        asrEndpoint: 'http://100.110.127.117:8001/asr/transcribe',
        translationEndpoint: 'http://100.110.127.117:8003/v1',
        translationModel: 'tencent/Hy-MT2-1.8B',
        sessionEventSink: 'api',
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('检查服务'));
    await tester.pumpAndSettle();

    expect(find.text('服务连接'), findsOneWidget);
    expect(find.text('正常'), findsNWidgets(2));
    expect(find.text('国内版', findRichText: true), findsOneWidget);
    expect(find.text('仅通话链接', findRichText: true), findsOneWidget);
    expect(find.text('个人信息保护法', findRichText: true), findsOneWidget);
    expect(find.text('Qwen LiveTranslate', findRichText: true), findsOneWidget);
    expect(find.text('LM Studio', findRichText: true), findsOneWidget);
    for (final text in <String>['ASR 端点', '翻译模型', 'tencent/Hy-MT2-1.8B']) {
      expect(find.text(text), findsOneWidget);
    }
    expect(find.text('API 历史同步', findRichText: true), findsOneWidget);
    expect(find.text('真机测试时请改用 Mac 局域网 IP，不能使用本机地址'), findsNothing);
  });

  testWidgets('warns when diagnostics service URLs use local-only addresses',
      (WidgetTester tester) async {
    final provider = FakeMobileAsrProvider();
    addTearDown(provider.dispose);

    await tester.pumpWidget(diagnosticsTestApp(
      provider: provider,
      shareService: FakeFileShareService(),
      config: diagnosticsConfig(
        apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      ),
      apiHealthFetcher: (_) async => const ApiHealthInfo(
        status: 'ok',
        realtimeWsEndpoint: 'ws://127.0.0.1:3201/realtime',
      ),
      gatewayHealthFetcher: (_) async => const GatewayHealthInfo(status: 'ok'),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('检查服务'));
    await tester.pumpAndSettle();

    expect(
      find.text(
        '真机请连接统一服务器地址，不能使用手机本机地址',
        findRichText: true,
      ),
      findsNWidgets(2),
    );
  });
}
