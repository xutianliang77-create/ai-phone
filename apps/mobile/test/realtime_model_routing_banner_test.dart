import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/model_routing_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_model_routing_banner.dart';

void main() {
  testWidgets('hides model route banner in on-device mode', (tester) async {
    await tester.pumpWidget(const _TestApp(
      processingMode: RealtimeProcessingMode.onDevice,
      routing: null,
    ));

    expect(find.text('服务器模型路由'), findsNothing);
  });

  testWidgets('shows active server model route in online mode', (tester) async {
    await tester.pumpWidget(_TestApp(
      processingMode: RealtimeProcessingMode.online,
      routing: _readyRouting(),
    ));

    expect(find.text('服务器模型路由'), findsOneWidget);
    expect(find.textContaining('Domestic server route'), findsOneWidget);
    expect(find.text('ASR FireRedASR2-AED'), findsOneWidget);
    expect(find.text('翻译 tencent/Hy-MT2-1.8B'), findsOneWidget);
    expect(find.text('TTS VoxCPM2'), findsOneWidget);
  });

  testWidgets('shows on-device fallback hint when online route is not ready',
      (tester) async {
    await tester.pumpWidget(const _TestApp(
      processingMode: RealtimeProcessingMode.online,
      routing: ModelRoutingSnapshot(
        status: 'not_ready',
        profiles: <ModelRoutingProfile>[],
        issues: <String>['model routing activeProfile must exist'],
      ),
    ));

    expect(find.text('服务器模型路由'), findsOneWidget);
    expect(find.textContaining('可切回端侧'), findsOneWidget);
    expect(find.textContaining('activeProfile'), findsOneWidget);
  });

  testWidgets('shows loading state before online route is loaded',
      (tester) async {
    await tester.pumpWidget(const _TestApp(
      processingMode: RealtimeProcessingMode.online,
      routing: null,
      loading: true,
    ));

    expect(find.text('服务器模型路由'), findsOneWidget);
    expect(find.text('正在读取在线模型配置'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows fallback hint when online route request fails',
      (tester) async {
    await tester.pumpWidget(const _TestApp(
      processingMode: RealtimeProcessingMode.online,
      routing: null,
      errorMessage: 'connection refused',
    ));

    expect(find.text('服务器模型路由'), findsOneWidget);
    expect(find.textContaining('模型路由不可用'), findsOneWidget);
    expect(find.textContaining('可切回端侧'), findsOneWidget);
    expect(find.textContaining('connection refused'), findsOneWidget);
  });
}

ModelRoutingSnapshot _readyRouting() {
  return const ModelRoutingSnapshot(
    status: 'ready',
    activeProfile: 'domestic_server',
    profiles: <ModelRoutingProfile>[
      ModelRoutingProfile(
        name: 'domestic_server',
        description: 'Domestic server route',
        asr: ModelProviderChoice(
          provider: 'http_fireredasr2_aed',
          model: 'FireRedASR2-AED',
          contract: 'POST /asr/transcribe',
        ),
        translation: ModelProviderChoice(
          provider: 'hymt2_self_hosted',
          model: 'tencent/Hy-MT2-1.8B',
          contract: 'OpenAI-compatible /v1/chat/completions',
        ),
        tts: ModelProviderChoice(
          provider: 'voxcpm2',
          model: 'VoxCPM2',
          contract: 'POST /tts/synthesize',
        ),
      ),
    ],
    issues: <String>[],
  );
}

class _TestApp extends StatelessWidget {
  const _TestApp({
    required this.processingMode,
    required this.routing,
    this.loading = false,
    this.errorMessage,
  });

  final RealtimeProcessingMode processingMode;
  final ModelRoutingSnapshot? routing;
  final bool loading;
  final String? errorMessage;

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
          child: RealtimeModelRoutingBanner(
            processingMode: processingMode,
            routing: routing,
            loading: loading,
            errorMessage: errorMessage,
          ),
        ),
      ),
    );
  }
}
