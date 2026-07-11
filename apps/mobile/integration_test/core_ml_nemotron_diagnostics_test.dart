import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

import 'core_ml_nemotron_model_scan_log.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('reports Core ML Nemotron diagnostics', (tester) async {
    const prepareModel = bool.fromEnvironment('DEVICE_ASR_PREPARE_MODEL');
    const language = String.fromEnvironment(
      'DEVICE_ASR_LANGUAGE',
      defaultValue: 'auto',
    );
    const autoDownloadModel = bool.fromEnvironment(
      'DEVICE_ASR_AUTO_DOWNLOAD_MODEL',
    );
    const modelChunkMs = int.fromEnvironment(
      'DEVICE_ASR_MODEL_CHUNK_MS',
      defaultValue: 2240,
    );

    final provider = CoreMlNemotronAsrProvider();
    addTearDown(() async {
      await provider.dispose();
      debugPrintSynchronously('COREML_NEMOTRON_DISPOSE_OK');
    });
    final availability = await provider.nativeAvailability();
    debugPrint('COREML_NEMOTRON_AVAILABILITY ${jsonEncode(availability)}');
    logCoreMlNemotronModelScan(
      'COREML_NEMOTRON_MODEL_SCAN',
      availability,
    );

    expect(availability['reason'], isA<String>());
    expect(availability['decoderReady'], isA<bool>());
    expect(availability['fluidAudio'], isA<Map>());
    expect(availability['modelScan'], isA<Map>());

    if (availability['localModelReady'] == true) {
      final model = await provider.inspectModel();
      debugPrint('COREML_NEMOTRON_MODEL ${jsonEncode(model)}');
      expect(model['models'], isA<Map>());
    }

    if (prepareModel) {
      await provider.prepare(
        const MobileAsrConfig(
          language: language,
          autoDownloadModel: autoDownloadModel,
          modelChunkMs: modelChunkMs,
        ),
      );
      debugPrint('COREML_NEMOTRON_PREPARE_OK');
      final preparedAvailability = await provider.nativeAvailability();
      debugPrint('COREML_NEMOTRON_AVAILABILITY_AFTER_PREPARE '
          '${jsonEncode(preparedAvailability)}');
      logCoreMlNemotronModelScan(
        'COREML_NEMOTRON_MODEL_SCAN_AFTER_PREPARE',
        preparedAvailability,
      );
      expect(preparedAvailability['preparedModelReady'], isTrue);
      expect(preparedAvailability['decoderReady'], isTrue);
    }
  });
}
