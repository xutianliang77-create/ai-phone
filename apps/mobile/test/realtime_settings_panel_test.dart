import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_panel.dart';
import 'package:translation_mobile/src/platform/translation/supported_translation_language.dart';

void main() {
  testWidgets('disables realtime auto speech when unsupported', (tester) async {
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.onDevice,
          sourceLanguage: autoSourceLanguageCode,
          targetLanguage: autoReverseTargetLanguageCode,
          voiceOutputMode: RealtimeVoiceOutputMode.natural,
        ),
        enabled: true,
        autoSpeakSupported: false,
        onChanged: (_) {},
      ),
    ));

    final selector = tester.widget<SegmentedButton<RealtimeVoiceOutputMode>>(
      find.byType(SegmentedButton<RealtimeVoiceOutputMode>),
    );

    expect(selector.selected, {RealtimeVoiceOutputMode.off});
    expect(selector.onSelectionChanged, isNull);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

  final Widget child;

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
      home: Scaffold(body: child),
    );
  }
}
