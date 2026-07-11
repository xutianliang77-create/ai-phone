import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_gateway_diagnostic.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_gateway_diagnostic_banner.dart';

void main() {
  testWidgets('hides banner for on-device mode without diagnostics',
      (tester) async {
    await tester.pumpWidget(_TestApp(
      processingMode: RealtimeProcessingMode.onDevice,
      diagnostic: null,
      onOpenDiagnostics: () {},
    ));

    expect(find.text('在线模型链路'), findsNothing);
  });

  testWidgets('shows online pipeline status and opens diagnostics',
      (tester) async {
    var openCount = 0;
    await tester.pumpWidget(_TestApp(
      processingMode: RealtimeProcessingMode.online,
      diagnostic: null,
      onOpenDiagnostics: () => openCount += 1,
    ));

    expect(find.text('在线模型链路'), findsOneWidget);
    expect(find.text('ASR、翻译、TTS 由服务器 Provider 处理'), findsOneWidget);

    await tester.tap(find.byTooltip('模型链路诊断'));
    expect(openCount, 1);
  });

  testWidgets('shows provider diagnostic labels for gateway errors',
      (tester) async {
    await tester.pumpWidget(_TestApp(
      processingMode: RealtimeProcessingMode.online,
      diagnostic: const RealtimeGatewayDiagnostic(
        type: 'error',
        displayMessage: 'ASR 识别（firered_asr）：网络连接失败，可重试',
        stage: 'asr',
        provider: 'firered_asr',
        retryable: true,
        code: 'provider_unavailable',
      ),
      onOpenDiagnostics: () {},
    ));

    expect(find.textContaining('网络连接失败'), findsOneWidget);
    expect(find.text('ASR 识别'), findsOneWidget);
    expect(find.text('firered_asr'), findsOneWidget);
    expect(find.text('可重试'), findsOneWidget);
    expect(find.text('provider_unavailable'), findsOneWidget);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({
    required this.processingMode,
    required this.diagnostic,
    required this.onOpenDiagnostics,
  });

  final RealtimeProcessingMode processingMode;
  final RealtimeGatewayDiagnostic? diagnostic;
  final VoidCallback onOpenDiagnostics;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: RealtimeGatewayDiagnosticBanner(
            processingMode: processingMode,
            diagnostic: diagnostic,
            onOpenDiagnostics: onOpenDiagnostics,
          ),
        ),
      ),
    );
  }
}
