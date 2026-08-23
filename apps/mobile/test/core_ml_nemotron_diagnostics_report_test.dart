import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/device_asr/data/core_ml_nemotron_diagnostics_report.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  test('exports app and runtime config metadata', () {
    final report = CoreMlNemotronDiagnosticsReport(
      capturedAt: DateTime.utc(2026, 6, 27, 10, 30),
      config: AppConfig(
        apiBaseUrl: Uri.parse('http://192.168.2.10:3100'),
        useMockAudio: false,
        useDeviceAsr: true,
        deviceAsrProvider: 'coreml_nemotron',
        deviceAsrLanguage: 'auto',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: true,
      ),
      allowDownload: true,
      apiHealth: null,
      gatewayHealth: null,
      apiHealthError: null,
      gatewayHealthError: null,
      availability: const MobileAsrAvailability(
        canStart: true,
        reason: 'ready',
        message: 'Device ASR ready',
      ),
      translationAvailability: const MobileTranslationAvailability(
        available: false,
        provider: 'ios_system',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        status: 'supported',
        reason: 'language_pair_not_installed',
      ),
      modelDetails: const <String, Object?>{
        'fluidAudio': <String, Object?>{
          'processingError': 'FluidAudio process failed',
          'audio': <String, Object?>{
            'inputBuffers': 2,
            'convertedSamples': 44800,
            'emittedChunks': 0,
          },
        },
      },
      selfTestSegments: const <AsrTextSegment>[
        AsrTextSegment(
          id: 'seg_1',
          text: 'hello private diagnostic text',
          language: 'en',
          isFinal: true,
          confidence: 0.9,
        ),
      ],
      selfTestRunning: false,
      selfTestMessage: null,
      error: null,
    );

    final json = report.toJson();
    expect(json['app'], <String, Object?>{
      'name': 'translation_mobile',
      'version': '0.1.0',
      'buildNumber': '1',
      'buildIdentity': <String, Object?>{
        'candidateId': 'untraceable',
        'sourceCommit': 'untraceable',
        'sourceTree': 'untraceable',
        'sourceState': 'unknown',
        'traceable': false,
      },
    });
    expect(json['runtimeConfig'], <String, Object?>{
      'apiBaseUrl': 'http://192.168.2.10:3100',
      'useMockAudio': false,
      'useDeviceAsr': true,
      'deviceAsrProvider': 'coreml_nemotron',
      'deviceAsrLanguage': 'auto',
      'deviceAsrAutoDownloadModel': false,
      'deviceAsrModelChunkMs': 2240,
      'deviceAsrChunkDurationMs': 320,
      'deviceAsrEndpointMinSpeechMs': 600,
      'deviceAsrEndpointSilenceMs': 900,
      'deviceAsrEndpointSpeechThresholdRms': 0.006,
      'deviceAsrVadProvider': 'fluidaudio_silero',
      'deviceAsrVadThreshold': 0.6,
      'deviceAsrVadNegativeThreshold': 0.35,
      'deviceAsrVadPreRollMs': 800,
      'deviceAsrDiagnosticCaptureEnabled': false,
      'useLocalSessions': false,
      'useOnDeviceTranslation': false,
      'onDeviceTranslationProvider': 'ios_system',
      'onDeviceTranslationRequired': false,
      'serverOwnedHistory': true,
      'allowDownloadSelected': true,
    });
    final selfTest = json['selfTest']! as Map<String, Object?>;
    final translation = json['translationAvailability']! as Map;
    expect(translation['provider'], 'ios_system');
    expect(translation['reason'], 'language_pair_not_installed');
    final audioDiagnostic = selfTest['audioDiagnostic']! as Map;
    expect(audioDiagnostic['status'], 'warning');
    expect(audioDiagnostic['issue'], 'asr_processing_error');
    expect((audioDiagnostic['audio']! as Map)['processingError'],
        'FluidAudio process failed');
    final segments = selfTest['segments']! as List<dynamic>;
    final segment = segments.single as Map<String, Object?>;
    expect(segment['textCharCount'], 29);
    expect(segment.containsKey('text'), isFalse);
  });
}
