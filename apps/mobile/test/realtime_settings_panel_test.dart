import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';
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

  testWidgets('selects an available online natural voice preset',
      (tester) async {
    RealtimeRuntimeSettings? changed;
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.online,
          sourceLanguage: 'zh',
          targetLanguage: 'en',
          voiceOutputMode: RealtimeVoiceOutputMode.natural,
        ),
        enabled: true,
        voicePresets: const <VoicePreset>[
          VoicePreset(
            id: 'zh_female_natural',
            zhLabel: '温暖女声',
            enLabel: 'Warm female',
            gender: 'female',
            tone: 'natural',
            scenario: 'conversation',
            accent: 'mandarin',
            languages: <String>['zh', 'en'],
          ),
          VoicePreset(
            id: 'zh_male_northeastern',
            zhLabel: '东北话男声',
            enLabel: 'Northeastern male',
            gender: 'male',
            tone: 'lively',
            scenario: 'conversation',
            accent: 'northeastern_mandarin',
            languages: <String>['zh'],
          ),
          VoicePreset(
            id: 'zh_female_cantonese',
            zhLabel: '粤语女声',
            enLabel: 'Cantonese female',
            gender: 'female',
            tone: 'natural',
            scenario: 'conversation',
            accent: 'cantonese',
            languages: <String>['zh'],
          ),
          VoicePreset(
            id: 'zh_male_minnan',
            zhLabel: '闽南语男声',
            enLabel: 'Minnan male',
            gender: 'male',
            tone: 'natural',
            scenario: 'conversation',
            accent: 'minnan',
            languages: <String>['zh'],
          ),
        ],
        onChanged: (settings) => changed = settings,
      ),
    ));

    expect(find.text('温暖女声'), findsOneWidget);
    await tester.tap(find.text('温暖女声'));
    await tester.pumpAndSettle();
    expect(find.text('粤语女声'), findsOneWidget);
    expect(find.text('闽南语男声'), findsOneWidget);
    await tester.tap(find.text('闽南语男声'));
    await tester.pumpAndSettle();

    expect(changed?.voicePresetId, 'zh_male_minnan');
  });

  testWidgets('selects a session domain lexicon pack', (tester) async {
    RealtimeRuntimeSettings? changed;
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.online,
          sourceLanguage: 'zh',
          targetLanguage: 'en',
          voiceOutputMode: RealtimeVoiceOutputMode.off,
        ),
        enabled: true,
        onChanged: (settings) => changed = settings,
      ),
    ));

    await tester.tap(find.text('通用'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('医疗'));
    await tester.pumpAndSettle();

    expect(changed?.domainLexiconPack, 'medical');
  });

  testWidgets(
      'disables automatic language locally while leaving fixed languages selectable',
      (tester) async {
    RealtimeRuntimeSettings? changed;
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.onDevice,
          sourceLanguage: autoSourceLanguageCode,
          targetLanguage: autoReverseTargetLanguageCode,
          voiceOutputMode: RealtimeVoiceOutputMode.natural,
        ),
        enabled: true,
        onChanged: (settings) => changed = settings,
      ),
    ));

    expect(find.text('行业词库'), findsOneWidget);
    expect(find.text('我的声音'), findsOneWidget);
    expect(find.textContaining('语言选择会保留'), findsOneWidget);
    expect(find.textContaining('端侧模式暂不提供自动语言'), findsOneWidget);
    expect(find.textContaining('本地使用系统声音'), findsOneWidget);

    await tester.tap(find.text('自动识别'));
    await tester.pumpAndSettle();
    final automatic = tester.widget<ListTile>(
        find.byKey(const ValueKey('translation-language-choice-auto')));
    expect(automatic.enabled, isFalse);
    expect(automatic.onTap, isNull);
    expect(find.text('中文'), findsOneWidget);
    expect(find.text('英语'), findsOneWidget);
    expect(find.text('法语'), findsOneWidget);
    await tester.tap(find.text('中文'));
    await tester.pumpAndSettle();
    expect(changed?.sourceLanguage, 'zh');
  });

  testWidgets('preserves online preferences when switching to local mode',
      (tester) async {
    RealtimeRuntimeSettings? changed;
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.online,
          sourceLanguage: 'fr',
          targetLanguage: 'ja',
          voiceOutputMode: RealtimeVoiceOutputMode.myVoice,
          domainLexiconPack: 'medical',
        ),
        enabled: true,
        onChanged: (settings) => changed = settings,
      ),
    ));

    await tester.tap(find.text('端侧'));
    await tester.pump();

    expect(changed?.sourceLanguage, 'fr');
    expect(changed?.targetLanguage, 'ja');
    expect(changed?.voiceOutputMode, RealtimeVoiceOutputMode.myVoice);
    expect(changed?.domainLexiconPack, 'medical');
  });

  testWidgets(
      'shows the saved personal voice as selected but unavailable locally',
      (tester) async {
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.onDevice,
          sourceLanguage: 'fr',
          targetLanguage: 'ja',
          voiceOutputMode: RealtimeVoiceOutputMode.myVoice,
          domainLexiconPack: 'medical',
        ),
        enabled: true,
        onChanged: (_) {},
      ),
    ));
    final selector = tester.widget<SegmentedButton<RealtimeVoiceOutputMode>>(
      find.byType(SegmentedButton<RealtimeVoiceOutputMode>),
    );
    expect(selector.selected, {RealtimeVoiceOutputMode.myVoice});
    expect(
        selector.segments
            .singleWhere(
                (item) => item.value == RealtimeVoiceOutputMode.myVoice)
            .enabled,
        false);
    expect(find.textContaining('已保留“我的声音”选择'), findsOneWidget);
    expect(find.text('医疗'), findsOneWidget);
  });

  testWidgets('groups settings and offers an end action while locked',
      (tester) async {
    var endRequested = false;
    await tester.pumpWidget(_TestApp(
      child: RealtimeSettingsPanel(
        settings: const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.online,
          sourceLanguage: 'zh',
          targetLanguage: 'en',
          voiceOutputMode: RealtimeVoiceOutputMode.off,
        ),
        enabled: false,
        onChanged: (_) {},
        onEndRequested: () => endRequested = true,
      ),
    ));

    expect(find.text('运行模式'), findsOneWidget);
    expect(find.text('语言与行业'), findsOneWidget);
    expect(find.text('声音'), findsOneWidget);
    expect(find.text('同传中不可切换设置'), findsOneWidget);
    await tester.tap(find.text('结束后修改'));
    expect(endRequested, isTrue);
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
