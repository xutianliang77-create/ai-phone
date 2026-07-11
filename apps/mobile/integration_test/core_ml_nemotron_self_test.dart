import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

import 'core_ml_nemotron_model_scan_log.dart';

const _deviceAsrStopDrain = Duration(milliseconds: 120);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('runs Core ML Nemotron microphone self-test', (tester) async {
    const language = String.fromEnvironment(
      'DEVICE_ASR_LANGUAGE',
      defaultValue: 'auto',
    );
    const autoDownloadModel = bool.fromEnvironment(
      'DEVICE_ASR_AUTO_DOWNLOAD_MODEL',
      defaultValue: true,
    );
    const modelChunkMs = int.fromEnvironment(
      'DEVICE_ASR_MODEL_CHUNK_MS',
      defaultValue: 2240,
    );
    const selfTestSeconds = int.fromEnvironment(
      'DEVICE_ASR_SELF_TEST_SECONDS',
      defaultValue: 15,
    );
    const expectSegment = bool.fromEnvironment(
      'DEVICE_ASR_EXPECT_SEGMENT',
      defaultValue: true,
    );
    const logText = bool.fromEnvironment('DEVICE_ASR_LOG_TEXT');
    const config = MobileAsrConfig(
      language: language,
      autoDownloadModel: autoDownloadModel,
      modelChunkMs: modelChunkMs,
    );
    const timeout = Duration(seconds: selfTestSeconds);
    final provider = CoreMlNemotronAsrProvider();
    addTearDown(() async {
      await provider.dispose();
      debugPrintSynchronously('COREML_NEMOTRON_SELF_TEST_DISPOSE_OK');
    });
    final segments = <AsrTextSegment>[];
    final firstSegment = Completer<void>();
    Map<String, Object?>? availabilityAfterStart;
    Map<String, Object?>? availabilityAfterStop;
    Object? runError;
    Object? stopError;
    String? audioCaptureError;

    final availability = await provider.availability(config);
    debugPrint('COREML_NEMOTRON_SELF_TEST_AVAILABILITY '
        '${jsonEncode(_availabilityToJson(availability))}');
    logCoreMlNemotronModelScan(
      'COREML_NEMOTRON_SELF_TEST_MODEL_SCAN',
      availability.details,
    );

    if (!availability.canStart) {
      runError = StateError(availability.message);
      debugPrint('COREML_NEMOTRON_SELF_TEST_ERROR '
          '${jsonEncode(_errorToJson(runError))}');
    } else {
      final subscription = provider.segments.listen(
        (segment) {
          segments.add(segment);
          debugPrint('COREML_NEMOTRON_SELF_TEST_SEGMENT '
              '${jsonEncode(_segmentToJson(segment, logText: logText))}');
          if (segment.text.trim().isNotEmpty && !firstSegment.isCompleted) {
            firstSegment.complete();
          }
        },
        onError: (Object error) {
          if (!firstSegment.isCompleted) {
            firstSegment.completeError(error);
          }
        },
      );

      try {
        await provider.requestPermission();
        await provider.prepare(config);
        await provider.start(config);
        availabilityAfterStart = await provider.nativeAvailability();
        logCoreMlNemotronRuntimeAvailability(
          'COREML_NEMOTRON_SELF_TEST_AVAILABILITY_AFTER_START',
          availabilityAfterStart,
        );
        debugPrint('COREML_NEMOTRON_SELF_TEST_STARTED');
        await Future.any<void>(<Future<void>>[
          firstSegment.future,
          Future<void>.delayed(timeout),
        ]);
      } catch (error) {
        runError = error;
        debugPrint('COREML_NEMOTRON_SELF_TEST_ERROR '
            '${jsonEncode(_errorToJson(error))}');
      } finally {
        try {
          await provider.stop();
          await Future<void>.delayed(_deviceAsrStopDrain);
        } catch (error) {
          stopError = error;
          debugPrint('COREML_NEMOTRON_SELF_TEST_STOP_ERROR '
              '${jsonEncode(_errorToJson(error))}');
        }
        try {
          availabilityAfterStop = await provider.nativeAvailability();
          logCoreMlNemotronRuntimeAvailability(
            'COREML_NEMOTRON_SELF_TEST_AVAILABILITY_AFTER_STOP',
            availabilityAfterStop,
          );
          final releaseIssue =
              coreMlNemotronStoppedAudioIssue(availabilityAfterStop);
          if (releaseIssue != null && stopError == null) {
            stopError = StateError(releaseIssue);
            debugPrint('COREML_NEMOTRON_SELF_TEST_STOP_ERROR '
                '${jsonEncode(_errorToJson(stopError))}');
          }
          if (expectSegment &&
              !segments.any((segment) => segment.text.trim().isNotEmpty)) {
            audioCaptureError =
                coreMlNemotronAudioCaptureIssue(availabilityAfterStop);
            if (audioCaptureError != null) {
              debugPrint('COREML_NEMOTRON_SELF_TEST_AUDIO_ERROR '
                  '${jsonEncode(_errorToJson(StateError(audioCaptureError)))}');
            }
          }
        } catch (_) {}
        await subscription.cancel();
        debugPrint('COREML_NEMOTRON_SELF_TEST_STOPPED');
      }
    }

    final report = <String, Object?>{
      'deviceAsrProvider': 'coreml_nemotron',
      'deviceAsrLanguage': language,
      'modelChunkMs': modelChunkMs,
      'autoDownloadModel': autoDownloadModel,
      'availability': _availabilityToJson(availability),
      'availabilityAfterStart': availabilityAfterStart == null
          ? null
          : coreMlNemotronRuntimeAvailabilitySummary(availabilityAfterStart),
      'availabilityAfterStop': availabilityAfterStop == null
          ? null
          : coreMlNemotronRuntimeAvailabilitySummary(availabilityAfterStop),
      'segmentCount': segments.length,
      'receivedCharCounts':
          segments.map((segment) => segment.text.length).toList(),
      if (logText)
        'receivedText': segments.map((segment) => segment.text).toList(),
      'expectSegment': expectSegment,
      'durationSeconds': selfTestSeconds,
      'error': runError?.toString(),
      'stopError': stopError?.toString(),
      'audioCaptureError': audioCaptureError,
    };
    debugPrint('COREML_NEMOTRON_SELF_TEST_RESULT ${jsonEncode(report)}');

    if (runError != null) {
      fail(runError.toString());
    }
    if (stopError != null) {
      fail(stopError.toString());
    }
    if (audioCaptureError != null) {
      fail(audioCaptureError);
    }
    if (expectSegment) {
      expect(
        segments.any((segment) => segment.text.trim().isNotEmpty),
        isTrue,
        reason: 'Speak a short Chinese or English sentence during self-test.',
      );
    }
  });
}

Map<String, Object?> _availabilityToJson(MobileAsrAvailability availability) {
  return <String, Object?>{
    'canStart': availability.canStart,
    'reason': availability.reason,
    'message': availability.message,
    'details': availability.details,
  };
}

Map<String, Object?> _errorToJson(Object error) {
  return <String, Object?>{
    'type': error.runtimeType.toString(),
    'message': error.toString(),
  };
}

Map<String, Object?> _segmentToJson(
  AsrTextSegment segment, {
  required bool logText,
}) {
  return <String, Object?>{
    'id': segment.id,
    'charCount': segment.text.length,
    if (logText) 'text': segment.text,
    'language': segment.language,
    'isFinal': segment.isFinal,
    'confidence': segment.confidence,
  };
}
