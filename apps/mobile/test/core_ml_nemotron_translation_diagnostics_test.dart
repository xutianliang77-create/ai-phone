import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/device_asr/presentation/pages/core_ml_nemotron_diagnostics_page.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  testWidgets('shows on-device translation availability diagnostics',
      (tester) async {
    final asr = _FakeMobileAsrProvider();
    final translation = _FakeTranslationProvider();
    addTearDown(asr.dispose);

    await tester.pumpWidget(_testApp(
      asr: asr,
      translation: translation,
    ));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('端侧翻译'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('端侧翻译'), findsOneWidget);
    expect(find.text('iOS 系统翻译', findRichText: true), findsOneWidget);
    expect(find.text('英文', findRichText: true), findsOneWidget);
    expect(find.text('中文', findRichText: true), findsOneWidget);
    expect(find.text('语言包未安装', findRichText: true), findsOneWidget);
  });
}

Widget _testApp({
  required MobileAsrProvider asr,
  required MobileTranslationProvider translation,
}) {
  return MaterialApp(
    locale: const Locale('zh'),
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: CoreMlNemotronDiagnosticsPage(
      provider: asr,
      translationProvider: translation,
      config: AppConfig(
        apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
        useMockAudio: false,
        useDeviceAsr: true,
        useOnDeviceTranslation: true,
        onDeviceTranslationProvider: 'ios_system',
        onDeviceTranslationRequired: true,
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        deviceAsrProvider: 'coreml_nemotron',
        deviceAsrLanguage: 'auto',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: true,
      ),
    ),
  );
}

class _FakeMobileAsrProvider
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrPreparation,
        MobileAsrModelInspector {
  final _segments = StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    return const MobileAsrAvailability(
      canStart: true,
      reason: 'ready',
      message: 'Device ASR ready',
    );
  }

  @override
  Future<Map<String, Object?>> inspectModel() async {
    return const <String, Object?>{};
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {}

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {
    await _segments.close();
  }
}

class _FakeTranslationProvider
    implements MobileTranslationProvider, MobileTranslationDiagnostics {
  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  ) async {
    return const MobileTranslationAvailability(
      available: false,
      provider: 'ios_system',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      status: 'supported',
      reason: 'language_pair_not_installed',
    );
  }

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    return null;
  }

  @override
  Future<void> dispose() async {}
}
