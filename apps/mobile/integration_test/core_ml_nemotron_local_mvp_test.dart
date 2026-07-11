import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

import 'core_ml_nemotron_model_scan_log.dart';

const _deviceAsrStopDrain = Duration(milliseconds: 120);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('runs Core ML Nemotron local on-device MVP', (tester) async {
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
    const localMvpSeconds = int.fromEnvironment(
      'DEVICE_ASR_LOCAL_MVP_SECONDS',
      defaultValue: 45,
    );
    const expectTranslation = bool.fromEnvironment(
      'DEVICE_ASR_EXPECT_TRANSLATION',
      defaultValue: true,
    );
    const asrConfig = MobileAsrConfig(
      language: language,
      autoDownloadModel: autoDownloadModel,
      modelChunkMs: modelChunkMs,
    );
    const timeout = Duration(seconds: localMvpSeconds);
    final appConfig = AppConfig.fromEnvironment();
    final provider = CoreMlNemotronAsrProvider();
    final translationProvider =
        createDefaultMobileTranslationProvider(appConfig);
    final controller = RealtimeController(
      config: appConfig,
      mobileAsrProvider: provider,
      mobileTranslationProvider: translationProvider,
    );
    final historyRepository = SessionHistoryRepository.fromConfig(appConfig);
    final localStore = LocalSessionStore();
    addTearDown(() async {
      controller.dispose();
      historyRepository.dispose();
      debugPrintSynchronously('COREML_NEMOTRON_LOCAL_MVP_DISPOSE_OK');
    });

    final beforeIds = appConfig.useLocalSessions
        ? await _safeSessionIds(historyRepository)
        : const <String>{};
    final segmentReady = Completer<void>();
    MobileTranslationAvailability? translationAvailability;
    Map<String, Object?>? availabilityAfterStart;
    Map<String, Object?>? availabilityAfterStop;
    Object? runError;
    Object? stopError;
    Object? historyError;
    Object? translationError;
    String? audioCaptureError;
    var historyDetailLoaded = false;
    var localHistorySaved = false;
    var localExportReady = false;
    var historySegmentCount = 0;
    var exportCharCount = 0;
    String? historyStatus;

    void controllerListener() {
      if (_segmentsReady(controller.segments, expectTranslation) &&
          !segmentReady.isCompleted) {
        segmentReady.complete();
      }
      if (controller.status == RealtimeStatus.ended &&
          !segmentReady.isCompleted) {
        segmentReady.complete();
      }
    }

    final availability = await provider.availability(asrConfig);
    debugPrint('COREML_NEMOTRON_LOCAL_MVP_AVAILABILITY '
        '${jsonEncode(_availabilityToJson(availability))}');
    logCoreMlNemotronModelScan(
      'COREML_NEMOTRON_LOCAL_MVP_MODEL_SCAN',
      availability.details,
    );
    final Object? translationDiagnostics = translationProvider;
    if (translationDiagnostics is MobileTranslationDiagnostics) {
      final currentTranslationAvailability =
          await translationDiagnostics.availability(
        createMobileTranslationConfig(appConfig),
      );
      translationAvailability = currentTranslationAvailability;
      debugPrint('COREML_NEMOTRON_LOCAL_MVP_TRANSLATION_AVAILABILITY '
          '${jsonEncode(currentTranslationAvailability.toJson())}');
    }

    controller.addListener(controllerListener);
    try {
      if (!appConfig.useLocalSessions) {
        throw StateError('USE_LOCAL_SESSIONS=true is required');
      }
      if (!appConfig.useOnDeviceTranslation) {
        throw StateError('USE_ON_DEVICE_TRANSLATION=true is required');
      }
      if (expectTranslation && translationAvailability?.available != true) {
        throw StateError(
          'on-device translation unavailable: '
          '${translationAvailability?.reason ?? 'missing_diagnostics'}',
        );
      }
      if (!availability.canStart) {
        throw StateError(availability.message);
      }

      await controller.start();
      availabilityAfterStart = await provider.nativeAvailability();
      logCoreMlNemotronRuntimeAvailability(
        'COREML_NEMOTRON_LOCAL_MVP_AVAILABILITY_AFTER_START',
        availabilityAfterStart,
      );
      debugPrint('COREML_NEMOTRON_LOCAL_MVP_STARTED');
      await Future.any<void>(<Future<void>>[
        segmentReady.future,
        Future<void>.delayed(timeout),
      ]);
      final endedMessage = controller.message;
      if (controller.status == RealtimeStatus.ended && endedMessage != null) {
        throw StateError(endedMessage);
      }
    } catch (error) {
      runError = error;
      debugPrint('COREML_NEMOTRON_LOCAL_MVP_ERROR '
          '${jsonEncode(_errorToJson(error))}');
    } finally {
      controller.removeListener(controllerListener);
      try {
        await controller.stop();
        await Future<void>.delayed(_deviceAsrStopDrain);
      } catch (error) {
        stopError = error;
        debugPrint('COREML_NEMOTRON_LOCAL_MVP_STOP_ERROR '
            '${jsonEncode(_errorToJson(error))}');
      }
      try {
        availabilityAfterStop = await provider.nativeAvailability();
        logCoreMlNemotronRuntimeAvailability(
          'COREML_NEMOTRON_LOCAL_MVP_AVAILABILITY_AFTER_STOP',
          availabilityAfterStop,
        );
        final releaseIssue =
            coreMlNemotronStoppedAudioIssue(availabilityAfterStop);
        if (releaseIssue != null && stopError == null) {
          stopError = StateError(releaseIssue);
          debugPrint('COREML_NEMOTRON_LOCAL_MVP_STOP_ERROR '
              '${jsonEncode(_errorToJson(stopError))}');
        }
        if (!_segmentsReady(controller.segments, expectTranslation)) {
          audioCaptureError =
              coreMlNemotronAudioCaptureIssue(availabilityAfterStop);
        }
      } catch (_) {}
    }

    try {
      final sessionId = await _newLocalSessionId(
        historyRepository,
        beforeIds,
      );
      if (sessionId == null) {
        throw StateError('local history session was not saved');
      }
      final detail = await historyRepository.getSession(sessionId);
      historyDetailLoaded = true;
      historyStatus = detail.status;
      historySegmentCount = detail.segments.length;
      localHistorySaved = detail.segments.any((segment) {
        final hasSource = segment.sourceText.trim().isNotEmpty;
        final hasTranslation = segment.translatedText.trim().isNotEmpty;
        return hasSource && (!expectTranslation || hasTranslation);
      });
      final export = await localStore.exportSession(sessionId);
      localExportReady =
          export.content.trim().isNotEmpty && export.filename.endsWith('.md');
      exportCharCount = export.content.length;
      debugPrint('COREML_NEMOTRON_LOCAL_MVP_HISTORY '
          '${jsonEncode({
            'sessionId': sessionId,
            'status': historyStatus,
            'segmentCount': historySegmentCount,
            'localHistorySaved': localHistorySaved,
            'localExportReady': localExportReady,
            'exportCharCount': exportCharCount,
          })}');
    } catch (error) {
      historyError = error;
      debugPrint('COREML_NEMOTRON_LOCAL_MVP_HISTORY_ERROR '
          '${jsonEncode(_errorToJson(error))}');
    }

    final translationFinal = controller.segments.any(
      (segment) => segment.translatedText.trim().isNotEmpty,
    );
    if (expectTranslation && !translationFinal) {
      translationError = StateError('local on-device translation was empty');
    }
    final result = <String, Object?>{
      'deviceAsrProvider': 'coreml_nemotron',
      'deviceAsrLanguage': language,
      'sourceLanguage': appConfig.sourceLanguage,
      'targetLanguage': appConfig.targetLanguage,
      'modelChunkMs': modelChunkMs,
      'autoDownloadModel': autoDownloadModel,
      'useLocalSessions': appConfig.useLocalSessions,
      'useOnDeviceTranslation': appConfig.useOnDeviceTranslation,
      'onDeviceTranslationProvider': appConfig.onDeviceTranslationProvider,
      'onDeviceTranslationRequired': appConfig.onDeviceTranslationRequired,
      'translationAvailability': translationAvailability?.toJson(),
      'availability': _availabilityToJson(availability),
      'availabilityAfterStart': availabilityAfterStart == null
          ? null
          : coreMlNemotronRuntimeAvailabilitySummary(availabilityAfterStart),
      'availabilityAfterStop': availabilityAfterStop == null
          ? null
          : coreMlNemotronRuntimeAvailabilitySummary(availabilityAfterStop),
      'segmentCount': controller.segments.length,
      'sourceCharCounts': controller.segments
          .map((segment) => segment.sourceText.length)
          .toList(),
      'translatedCharCounts': controller.segments
          .map((segment) => segment.translatedText.length)
          .toList(),
      'translationFinal': translationFinal,
      'expectTranslation': expectTranslation,
      'historyDetailLoaded': historyDetailLoaded,
      'localHistorySaved': localHistorySaved,
      'localExportReady': localExportReady,
      'historySegmentCount': historySegmentCount,
      'historyStatus': historyStatus,
      'exportCharCount': exportCharCount,
      'durationSeconds': localMvpSeconds,
      'error': runError?.toString(),
      'stopError': stopError?.toString(),
      'translationError': translationError?.toString(),
      'historyError': historyError?.toString(),
      'audioCaptureError': audioCaptureError,
    };
    debugPrint('COREML_NEMOTRON_LOCAL_MVP_RESULT ${jsonEncode(result)}');

    if (runError != null) fail(runError.toString());
    if (stopError != null) fail(stopError.toString());
    if (translationError != null) fail(translationError.toString());
    if (historyError != null) fail(historyError.toString());
    if (audioCaptureError != null) fail(audioCaptureError);
    expect(historyDetailLoaded, isTrue);
    expect(localHistorySaved, isTrue);
    expect(localExportReady, isTrue);
    expect(historyStatus, 'ended');
  });
}

bool _segmentsReady(List<SubtitleSegment> segments, bool expectTranslation) {
  return segments.any((segment) {
    final hasSource = segment.sourceText.trim().isNotEmpty;
    final hasTranslation = segment.translatedText.trim().isNotEmpty;
    return hasSource && (!expectTranslation || hasTranslation);
  });
}

Future<Set<String>> _safeSessionIds(
  SessionHistoryRepository repository,
) async {
  try {
    final sessions = await repository.listSessions();
    return sessions.map((session) => session.sessionId).toSet();
  } catch (_) {
    return const <String>{};
  }
}

Future<String?> _newLocalSessionId(
  SessionHistoryRepository repository,
  Set<String> beforeIds,
) async {
  final sessions = await repository.listSessions();
  for (final session in sessions) {
    if (!beforeIds.contains(session.sessionId)) return session.sessionId;
  }
  return sessions.isEmpty ? null : sessions.first.sessionId;
}

Map<String, Object?> _availabilityToJson(MobileAsrAvailability availability) {
  return <String, Object?>{
    'canStart': availability.canStart,
    'reason': availability.reason,
    'message': availability.message,
    'details': availability.details,
  };
}

Map<String, Object?> _errorToJson(Object? error) {
  return <String, Object?>{
    'type': error.runtimeType.toString(),
    'message': error.toString(),
  };
}
