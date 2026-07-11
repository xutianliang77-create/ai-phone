import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/history/data/session_history_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

import 'core_ml_nemotron_gateway_e2e_support.dart';
import 'core_ml_nemotron_model_scan_log.dart';

const _deviceAsrStopDrain = Duration(milliseconds: 120);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('runs Core ML Nemotron ASR through Gateway', (tester) async {
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
    const e2eSeconds = int.fromEnvironment(
      'DEVICE_ASR_E2E_SECONDS',
      defaultValue: 30,
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
    const timeout = Duration(seconds: e2eSeconds);
    final appConfig = AppConfig.fromEnvironment();
    final serverOwnedHistory = appConfig.serverOwnedHistory;
    final provider = CoreMlNemotronAsrProvider();
    addTearDown(() async {
      await provider.dispose();
      debugPrintSynchronously('COREML_NEMOTRON_GATEWAY_E2E_DISPOSE_OK');
    });
    final drafts = <String, GatewayE2eSegmentDraft>{};
    final asrSent = Completer<void>();
    final translationFinal = Completer<void>();
    StreamSubscription<AsrTextSegment>? asrSubscription;
    StreamSubscription<GatewayRealtimeEvent>? gatewaySubscription;
    String? sessionId;
    var asrSendStarted = false;
    Object? runError;
    Object? stopError;
    Object? endError;
    Object? asrSendError;
    Object? translationError;
    Object? historyError;
    String? audioCaptureError;
    Map<String, Object?>? availabilityAfterStart;
    Map<String, Object?>? availabilityAfterStop;
    Object? apiHealthError;
    var apiHealthOk = false;
    String? apiHealthService;
    String? apiHealthRealtimeWsEndpoint;
    GatewayHealthResult? gatewayHealth;
    var historyDetailLoaded = false;
    var historySaved = false;
    var historySegmentCount = 0;
    String? historyStatus;

    try {
      final health = await fetchApiHealth(appConfig.apiBaseUrl);
      apiHealthOk = true;
      apiHealthService = health['service'] as String?;
      apiHealthRealtimeWsEndpoint = health['realtimeWsEndpoint'] as String?;
      gatewayHealth = await fetchGatewayHealthFromApiHealth(health);
      debugPrint('COREML_NEMOTRON_GATEWAY_E2E_API_HEALTH '
          '${jsonEncode({
            'ok': true,
            'service': apiHealthService,
            'realtimeWsEndpoint': apiHealthRealtimeWsEndpoint,
          })}');
      debugPrint('COREML_NEMOTRON_GATEWAY_E2E_GATEWAY_HEALTH '
          '${jsonEncode(gatewayHealth.toJson())}');
    } catch (error) {
      apiHealthError = error;
      debugPrint('COREML_NEMOTRON_GATEWAY_E2E_API_HEALTH_ERROR '
          '${jsonEncode(errorToJson(error))}');
    }

    final availability = await provider.availability(asrConfig);
    debugPrint('COREML_NEMOTRON_GATEWAY_E2E_AVAILABILITY '
        '${jsonEncode(availabilityToJson(availability))}');
    logCoreMlNemotronModelScan(
      'COREML_NEMOTRON_GATEWAY_E2E_MODEL_SCAN',
      availability.details,
    );

    final gatewayRoutingError = gatewayHealthRoutingError(
      health: gatewayHealth,
      expectTranslation: expectTranslation,
      serverOwnedHistory: serverOwnedHistory,
    );

    if (!availability.canStart) {
      runError = StateError(availability.message);
      debugPrint('COREML_NEMOTRON_GATEWAY_E2E_ERROR '
          '${jsonEncode(errorToJson(runError))}');
    } else if (!apiHealthOk) {
      runError = StateError('API health check failed from the iPhone app');
      debugPrint('COREML_NEMOTRON_GATEWAY_E2E_ERROR '
          '${jsonEncode(errorToJson(runError))}');
    } else if (gatewayRoutingError != null) {
      runError = StateError(gatewayRoutingError);
      debugPrint('COREML_NEMOTRON_GATEWAY_E2E_ERROR '
          '${jsonEncode(errorToJson(runError))}');
    } else {
      final repository = RealtimeRepository.fromConfig(appConfig);
      gatewaySubscription = repository.events.listen((event) {
        logGatewayE2eEvent(event);
        mergeGatewayEventDraft(drafts, event);
        if (event.type == 'translation.final') {
          if ((event.text ?? '').trim().isNotEmpty &&
              !translationFinal.isCompleted) {
            translationFinal.complete();
          }
        }
        if (event.type == 'error' && !translationFinal.isCompleted) {
          final error = StateError(event.message ?? 'Gateway error');
          translationError = error;
          translationFinal.completeError(error);
        }
      });

      try {
        final session = await repository.startSession();
        sessionId = session.sessionId;
        debugPrint('COREML_NEMOTRON_GATEWAY_E2E_SESSION '
            '${jsonEncode({'sessionId': session.sessionId})}');

        asrSubscription = provider.segments.listen(
          (segment) {
            final activeSessionId = sessionId;
            if (!segment.isFinal ||
                segment.text.trim().isEmpty ||
                asrSendStarted ||
                activeSessionId == null) {
              return;
            }
            asrSendStarted = true;
            drafts[segment.id] =
                GatewayE2eSegmentDraft(sourceText: segment.text);
            final sent = repository.sendTextSegment(activeSessionId, segment);
            if (!sent) {
              final error = StateError('Realtime Gateway is not connected');
              asrSendError = error;
              if (!asrSent.isCompleted) asrSent.completeError(error);
              if (!translationFinal.isCompleted) {
                translationError = error;
                translationFinal.completeError(error);
              }
              return;
            }
            if (!asrSent.isCompleted) asrSent.complete();
            debugPrint('COREML_NEMOTRON_GATEWAY_E2E_ASR_SENT '
                '${jsonEncode(segmentMeta(segment))}');
          },
          onError: (Object error) {
            asrSendError = error;
            if (!asrSent.isCompleted) asrSent.completeError(error);
          },
        );

        await provider.requestPermission();
        await provider.prepare(asrConfig);
        await provider.start(asrConfig);
        availabilityAfterStart = await provider.nativeAvailability();
        logCoreMlNemotronRuntimeAvailability(
          'COREML_NEMOTRON_GATEWAY_E2E_AVAILABILITY_AFTER_START',
          availabilityAfterStart,
        );
        debugPrint('COREML_NEMOTRON_GATEWAY_E2E_STARTED');
        await Future.any<void>(<Future<void>>[
          translationFinal.future,
          Future<void>.delayed(timeout),
        ]);
      } catch (error) {
        runError = error;
        debugPrint('COREML_NEMOTRON_GATEWAY_E2E_ERROR '
            '${jsonEncode(errorToJson(error))}');
      } finally {
        try {
          await provider.stop();
          await Future<void>.delayed(_deviceAsrStopDrain);
        } catch (error) {
          stopError = error;
          debugPrint('COREML_NEMOTRON_GATEWAY_E2E_STOP_ERROR '
              '${jsonEncode(errorToJson(error))}');
        }
        try {
          availabilityAfterStop = await provider.nativeAvailability();
          logCoreMlNemotronRuntimeAvailability(
            'COREML_NEMOTRON_GATEWAY_E2E_AVAILABILITY_AFTER_STOP',
            availabilityAfterStop,
          );
          final releaseIssue =
              coreMlNemotronStoppedAudioIssue(availabilityAfterStop);
          if (releaseIssue != null && stopError == null) {
            stopError = StateError(releaseIssue);
            debugPrint('COREML_NEMOTRON_GATEWAY_E2E_STOP_ERROR '
                '${jsonEncode(errorToJson(stopError))}');
          }
          if (expectTranslation && !asrSendStarted) {
            audioCaptureError =
                coreMlNemotronAudioCaptureIssue(availabilityAfterStop);
            if (audioCaptureError != null) {
              debugPrint('COREML_NEMOTRON_GATEWAY_E2E_AUDIO_ERROR '
                  '${jsonEncode(errorToJson(StateError(audioCaptureError)))}');
            }
          }
        } catch (_) {}
        await asrSubscription?.cancel();
        debugPrint('COREML_NEMOTRON_GATEWAY_E2E_ASR_STOPPED');

        final id = sessionId;
        if (id != null) {
          try {
            await repository.end(
              id,
              subtitleSegmentsFromDrafts(drafts),
            );
            debugPrint('COREML_NEMOTRON_GATEWAY_E2E_SESSION_ENDED '
                '${jsonEncode({'sessionId': id})}');
            final historyClient = SessionHistoryApiClient(
              baseUrl: appConfig.apiBaseUrl,
            );
            try {
              final detail = await waitForHistoryDetail(
                historyClient,
                id,
                requireSavedSegment: expectTranslation,
                requireEnded: serverOwnedHistory && expectTranslation,
              );
              historyDetailLoaded = true;
              historyStatus = detail.status;
              historySegmentCount = detail.segments.length;
              historySaved = detail.segments.any((segment) {
                return segment.sourceText.trim().isNotEmpty ||
                    segment.translatedText.trim().isNotEmpty;
              });
              debugPrint('COREML_NEMOTRON_GATEWAY_E2E_HISTORY '
                  '${jsonEncode(historyLogPayload(id, detail, historySaved))}');
            } catch (error) {
              historyError = error;
              debugPrint('COREML_NEMOTRON_GATEWAY_E2E_HISTORY_ERROR '
                  '${jsonEncode(errorToJson(error))}');
            } finally {
              historyClient.close();
            }
          } catch (error) {
            endError = error;
            debugPrint('COREML_NEMOTRON_GATEWAY_E2E_END_ERROR '
                '${jsonEncode(errorToJson(error))}');
          }
        }
        await gatewaySubscription.cancel();
        repository.dispose();
      }
    }

    final result = gatewayE2eResultJson(
      availability: availability,
      availabilityAfterStart: availabilityAfterStart,
      availabilityAfterStop: availabilityAfterStop,
      drafts: drafts,
      asrSent: asrSent.isCompleted,
      asrSendStarted: asrSendStarted,
      translationFinal: translationFinal.isCompleted,
      expectTranslation: expectTranslation,
      serverOwnedHistory: serverOwnedHistory,
      durationSeconds: e2eSeconds,
      sourceLanguage: appConfig.sourceLanguage,
      targetLanguage: appConfig.targetLanguage,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: language,
      autoDownloadModel: autoDownloadModel,
      modelChunkMs: modelChunkMs,
      runError: runError,
      stopError: stopError,
      endError: endError,
      asrSendError: asrSendError,
      translationError: translationError,
      historyError: historyError,
      audioCaptureError: audioCaptureError,
      apiHealthError: apiHealthError,
      apiHealthOk: apiHealthOk,
      apiHealthService: apiHealthService,
      apiHealthRealtimeWsEndpoint: apiHealthRealtimeWsEndpoint,
      gatewayHealth: gatewayHealth,
      historyDetailLoaded: historyDetailLoaded,
      historySaved: historySaved,
      historySegmentCount: historySegmentCount,
      historyStatus: historyStatus,
    );
    debugPrint('COREML_NEMOTRON_GATEWAY_E2E_RESULT ${jsonEncode(result)}');

    if (runError != null) {
      fail(runError.toString());
    }
    if (stopError != null) {
      fail(stopError.toString());
    }
    if (endError != null) {
      fail(endError.toString());
    }
    if (historyError != null) {
      fail(historyError.toString());
    }
    if (audioCaptureError != null) {
      fail(audioCaptureError);
    }
    if (expectTranslation) {
      expect(apiHealthOk, isTrue);
      expect(asrSent.isCompleted, isTrue);
      expect(translationFinal.isCompleted, isTrue);
      expect(historyDetailLoaded, isTrue);
      expect(historySaved, isTrue);
      if (serverOwnedHistory) {
        expect(historyStatus, 'ended');
      }
    }
  });
}
