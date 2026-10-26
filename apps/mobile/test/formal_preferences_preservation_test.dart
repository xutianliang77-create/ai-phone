import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/realtime_preferences_page.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_panel.dart';

void main() {
  testWidgets(
      'formal preferences explain unsupported saved settings without overwriting them',
      (tester) async {
    const saved = RealtimeRuntimeSettings(
        processingMode: RealtimeProcessingMode.onDevice,
        sourceLanguage: 'fr',
        targetLanguage: 'ja',
        voiceOutputMode: RealtimeVoiceOutputMode.myVoice);
    final store = MemoryRealtimeSettingsStore(saved);
    final config = AppConfig(
        apiBaseUrl: Uri.parse('https://api.publisher.cn'),
        executionMode: 'on_device', useLocalSessions: true, useOnDeviceTranslation: true, onDeviceTranslationRequired: true,
        distributionChannel: 'app_store',
        productProfile: 'core_translation',
        useMockAudio: false,
        useDeviceAsr: true,
        deviceAsrProvider: 'apple_speech_transcriber',
        deviceAsrLanguage: 'auto',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: false);
    final catalog = VoicePresetClient(
        baseUrl: config.apiBaseUrl,
        client: MockClient((_) async => http.Response('{"presets":[]}', 200)));
    addTearDown(catalog.close);
    await tester.pumpWidget(MaterialApp(
        locale: const Locale('zh'),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: RealtimePreferencesPage(
            config: config, settingsStore: store, voicePresetClient: catalog)));
    await tester.pumpAndSettle();
    expect(find.textContaining('原设置已保留'), findsOneWidget);
    expect((await store.load())?.toJson(), saved.toJson());
    final panel = tester
        .widget<RealtimeSettingsPanel>(find.byType(RealtimeSettingsPanel));
    expect(panel.onlineCoreOnly, isFalse);
    expect(panel.settings.processingMode, RealtimeProcessingMode.onDevice);
    panel.onChanged(saved);
    await tester.pumpAndSettle();
    expect((await store.load())?.toJson(), saved.toJson());
  });
}
