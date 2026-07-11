import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/device_asr/presentation/pages/core_ml_nemotron_diagnostics_page.dart';
import 'package:translation_mobile/src/features/realtime/data/api/api_health_client.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

Widget diagnosticsTestApp({
  required MobileAsrProvider provider,
  required FileShareService shareService,
  AppConfig? config,
  ApiHealthFetcher? apiHealthFetcher,
  GatewayHealthFetcher? gatewayHealthFetcher,
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
      provider: provider,
      config: config,
      shareService: shareService,
      apiHealthFetcher: apiHealthFetcher,
      gatewayHealthFetcher: gatewayHealthFetcher,
      selfTestDuration: const Duration(seconds: 30),
    ),
  );
}

AppConfig diagnosticsConfig({required Uri apiBaseUrl}) {
  return AppConfig(
    apiBaseUrl: apiBaseUrl,
    useMockAudio: false,
    useDeviceAsr: true,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}

class FakeFileShareService implements FileShareService {
  List<int>? bytes;
  String? filename;
  String? sharedPath;
  String? mimeType;

  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    this.bytes = bytes;
    this.filename = filename;
    return '/tmp/$filename';
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {
    sharedPath = path;
    this.mimeType = mimeType;
  }
}

class FakeMobileAsrProvider
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrPreparation,
        MobileAsrModelInspector {
  final StreamController<AsrTextSegment> _segments =
      StreamController<AsrTextSegment>.broadcast();
  final List<String> calls = <String>[];

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    calls.add('availability');
    return const MobileAsrAvailability(
      canStart: true,
      reason: 'ready',
      message: 'Device ASR ready',
      details: <String, Object?>{
        'localModelReady': true,
        'decoderReady': true,
        'fluidAudio': <String, Object?>{
          'runtimeAvailable': true,
          'audio': <String, Object?>{
            'inputBuffers': 2,
            'convertedSamples': 44800,
            'emittedChunks': 1,
          },
        },
      },
    );
  }

  @override
  Future<Map<String, Object?>> inspectModel() async {
    calls.add('inspectModel');
    return const <String, Object?>{'model': 'ready'};
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
    _segments.add(const AsrTextSegment(
      id: 'self_test_1',
      text: 'hello from device self test',
      language: 'en',
      isFinal: true,
      confidence: 0.91,
    ));
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
