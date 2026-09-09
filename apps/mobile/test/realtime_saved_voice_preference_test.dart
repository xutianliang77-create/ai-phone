import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/app_language.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/realtime_page.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_language_menu.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_panel.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_status_bar.dart';

void main() {
  testWidgets(
      'catalog refresh does not overwrite the saved voice or other local preferences',
      (tester) async {
    const settings = RealtimeRuntimeSettings(
      processingMode: RealtimeProcessingMode.onDevice,
      sourceLanguage: 'fr',
      targetLanguage: 'ja',
      voiceOutputMode: RealtimeVoiceOutputMode.myVoice,
      voicePresetId: 'saved_voice_missing_from_catalog',
      domainLexiconPack: 'medical',
    );
    final store = MemoryRealtimeSettingsStore(settings);
    final catalog = _DelayedCatalog();
    final config = AppConfig(
      apiBaseUrl: Uri.parse('http://localhost:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      useLocalSessions: true,
      useOnDeviceTranslation: true,
      deviceAsrProvider: 'apple_speech_transcriber',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 256,
      serverOwnedHistory: false,
    );
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate
      ],
      home: AppLanguageScope(
          locale: const Locale('zh'),
          onChanged: (_) {},
          child: RealtimePage(
              config: config,
              settingsStore: store,
              voicePresetClient: catalog)),
    ));
    await tester.pumpAndSettle();
    catalog.complete();
    await tester.pumpAndSettle();
    expect((await store.load())!.toJson(), settings.toJson());
    expect(
        tester
            .widget<RealtimeStatusBar>(find.byType(RealtimeStatusBar))
            .autoSpeakTranslation,
        false);
    tester
        .widget<RealtimeLanguageMenu>(find.byType(RealtimeLanguageMenu))
        .onOpenRealtimeSettings();
    await tester.pumpAndSettle();
    final panel = tester
        .widget<RealtimeSettingsPanel>(find.byType(RealtimeSettingsPanel));
    expect(panel.settings.toJson(), settings.toJson());
    expect(find.textContaining('已保留“我的声音”选择'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    catalog.close();
  });
}

class _DelayedCatalog extends VoicePresetClient {
  _DelayedCatalog() : super(baseUrl: Uri.parse('http://localhost'));
  final result = Completer<VoicePresetCatalog>();
  @override
  Future<VoicePresetCatalog> load() => result.future;
  void complete() => result.complete(const VoicePresetCatalog(
        version: 'test',
        defaultPresetId: 'new_default',
        presets: [
          VoicePreset(
            id: 'new_default',
            zhLabel: '新的默认声音',
            enLabel: 'New default',
            gender: 'neutral',
            tone: 'natural',
            scenario: 'conversation',
            accent: 'mandarin',
            languages: ['zh'],
          )
        ],
      ));
}
