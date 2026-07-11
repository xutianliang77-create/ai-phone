import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/device_asr/presentation/pages/core_ml_nemotron_diagnostics_page.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  testWidgets('refreshes audio session diagnostics after self-test start fails',
      (tester) async {
    final provider = _FailingRuntimeAsrProvider();
    final shareService = _CaptureShareService();
    addTearDown(provider.dispose);

    await tester.pumpWidget(_testApp(provider, shareService));
    await tester.pumpAndSettle();

    await tester.tap(find.text('开始自测'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(
        provider.calls,
        containsAll(<String>[
          'requestPermission',
          'prepare',
          'start',
          'stop',
          'nativeAvailability',
        ]));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.scrollUntilVisible(
      find.text('音频会话错误'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('音频会话错误'), findsOneWidget);
    expect(
        find.textContaining('AVAudioSession activation failed'), findsWidgets);
    await tester.scrollUntilVisible(
      find.textContaining('iOS 音频会话启动失败'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining('iOS 音频会话启动失败'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.widgetWithText(OutlinedButton, '导出诊断'),
      -160,
      scrollable: find.byType(Scrollable).first,
    );
    final exportButton = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, '导出诊断'),
    );
    expect(exportButton.onPressed, isNotNull);
    exportButton.onPressed!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final report =
        jsonDecode(utf8.decode(shareService.bytes!)) as Map<String, Object?>;
    final selfTest = report['selfTest']! as Map<String, Object?>;
    final audioDiagnostic =
        selfTest['audioDiagnostic']! as Map<String, Object?>;
    expect(audioDiagnostic['issue'], 'audio_session_error');
    expect(report['error'], contains('native start failed'));
  });
}

Widget _testApp(MobileAsrProvider provider, FileShareService shareService) {
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
      provider: provider,
      shareService: shareService,
      selfTestDuration: const Duration(seconds: 30),
    ),
  );
}

class _FailingRuntimeAsrProvider
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrPreparation,
        MobileAsrRuntimeInspector {
  final List<String> calls = <String>[];
  final StreamController<AsrTextSegment> _segments =
      StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    calls.add('availability');
    return const MobileAsrAvailability(
      canStart: true,
      reason: 'ready',
      message: 'Device ASR ready',
    );
  }

  @override
  Future<Map<String, Object?>> nativeAvailability() async {
    calls.add('nativeAvailability');
    return const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'sessionActive': false,
          'sessionError': 'AVAudioSession activation failed',
          'inputBuffers': 0,
          'convertedSamples': 0,
          'emittedChunks': 0,
        },
      },
    };
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {
    calls.add('prepare');
  }

  @override
  Future<void> requestPermission() async {
    calls.add('requestPermission');
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    calls.add('start');
    throw StateError('native start failed');
  }

  @override
  Future<void> stop() async {
    calls.add('stop');
  }

  @override
  Future<void> dispose() async {
    calls.add('dispose');
    await _segments.close();
  }
}

class _CaptureShareService implements FileShareService {
  List<int>? bytes;
  String? sharedPath;
  String? mimeType;

  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    this.bytes = bytes;
    return '/tmp/$filename';
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {
    sharedPath = path;
    this.mimeType = mimeType;
  }
}
