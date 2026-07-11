import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:translation_mobile/src/features/history/data/session_history_api_client.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

import 'core_ml_nemotron_model_scan_log.dart';

class GatewayE2eSegmentDraft {
  GatewayE2eSegmentDraft({
    this.sourceText = '',
    this.translatedText = '',
  });

  String sourceText;
  String translatedText;
}

class GatewayHealthResult {
  const GatewayHealthResult({
    required this.ok,
    this.service,
    this.provider,
    this.asrProvider,
    this.sessionEventSink,
    this.error,
  });

  final bool ok;
  final String? service;
  final String? provider;
  final String? asrProvider;
  final String? sessionEventSink;
  final String? error;

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'ok': ok,
      'service': service,
      'provider': provider,
      'asrProvider': asrProvider,
      'sessionEventSink': sessionEventSink,
      'error': error,
    };
  }
}

const expectedGatewayProvider = String.fromEnvironment(
  'EXPECTED_GATEWAY_PROVIDER',
  defaultValue: 'lmstudio',
);
const expectedGatewayAsrProvider = String.fromEnvironment(
  'EXPECTED_GATEWAY_ASR_PROVIDER',
  defaultValue: 'mock',
);
const expectedGatewaySessionEventSink = String.fromEnvironment(
  'EXPECTED_GATEWAY_SESSION_EVENT_SINK',
  defaultValue: 'api',
);

String? gatewayHealthRoutingError({
  required GatewayHealthResult? health,
  required bool expectTranslation,
  required bool serverOwnedHistory,
}) {
  if (expectTranslation && health?.provider != expectedGatewayProvider) {
    return 'Gateway provider must be $expectedGatewayProvider';
  }
  if (expectTranslation && health?.asrProvider != expectedGatewayAsrProvider) {
    return 'Gateway ASR provider must be $expectedGatewayAsrProvider';
  }
  if (serverOwnedHistory &&
      health?.sessionEventSink != expectedGatewaySessionEventSink) {
    return 'Gateway sessionEventSink must be $expectedGatewaySessionEventSink';
  }
  return null;
}

void logGatewayE2eEvent(GatewayRealtimeEvent event) {
  debugPrint('COREML_NEMOTRON_GATEWAY_E2E_EVENT '
      '${jsonEncode({
        'type': event.type,
        'segmentId': event.segmentId,
        'textCharCount': event.text?.length ?? 0,
        'message': event.message,
      })}');
}

void mergeGatewayEventDraft(
  Map<String, GatewayE2eSegmentDraft> drafts,
  GatewayRealtimeEvent event,
) {
  final segmentId = event.segmentId;
  if (segmentId == null) return;
  final draft = drafts.putIfAbsent(segmentId, GatewayE2eSegmentDraft.new);
  if (event.type == 'transcript.final') {
    draft.sourceText = event.text ?? draft.sourceText;
  }
  if (event.type == 'translation.final') {
    draft.translatedText = event.text ?? draft.translatedText;
  }
}

Map<String, Object?> availabilityToJson(MobileAsrAvailability availability) {
  return <String, Object?>{
    'canStart': availability.canStart,
    'reason': availability.reason,
    'message': availability.message,
    'details': availability.details,
  };
}

List<SubtitleSegment> subtitleSegmentsFromDrafts(
  Map<String, GatewayE2eSegmentDraft> drafts,
) {
  return drafts.entries.map((entry) {
    return SubtitleSegment(
      id: entry.key,
      sourceText: entry.value.sourceText,
      translatedText: entry.value.translatedText,
    );
  }).toList();
}

Map<String, Object?> historyLogPayload(
  String sessionId,
  SessionDetail detail,
  bool historySaved,
) {
  return <String, Object?>{
    'sessionId': sessionId,
    'status': detail.status,
    'segmentCount': detail.segments.length,
    'historySaved': historySaved,
    'segments': detail.segments.map((segment) {
      return <String, Object?>{
        'id': segment.id,
        'sourceCharCount': segment.sourceText.length,
        'translatedCharCount': segment.translatedText.length,
      };
    }).toList(),
  };
}

Map<String, Object?> gatewayE2eResultJson({
  required MobileAsrAvailability availability,
  required Map<String, GatewayE2eSegmentDraft> drafts,
  required bool asrSent,
  required bool asrSendStarted,
  required bool translationFinal,
  required bool expectTranslation,
  required bool serverOwnedHistory,
  required int durationSeconds,
  required String sourceLanguage,
  required String targetLanguage,
  required String deviceAsrProvider,
  required String deviceAsrLanguage,
  required bool autoDownloadModel,
  required int modelChunkMs,
  required bool apiHealthOk,
  required bool historyDetailLoaded,
  required bool historySaved,
  required int historySegmentCount,
  Map<String, Object?>? availabilityAfterStart,
  Map<String, Object?>? availabilityAfterStop,
  Object? runError,
  Object? stopError,
  Object? endError,
  Object? asrSendError,
  Object? translationError,
  Object? historyError,
  String? audioCaptureError,
  Object? apiHealthError,
  String? apiHealthService,
  String? apiHealthRealtimeWsEndpoint,
  GatewayHealthResult? gatewayHealth,
  String? historyStatus,
}) {
  return <String, Object?>{
    'deviceAsrProvider': deviceAsrProvider,
    'deviceAsrLanguage': deviceAsrLanguage,
    'sourceLanguage': sourceLanguage,
    'targetLanguage': targetLanguage,
    'modelChunkMs': modelChunkMs,
    'autoDownloadModel': autoDownloadModel,
    'availability': availabilityToJson(availability),
    'availabilityAfterStart': availabilityAfterStart == null
        ? null
        : coreMlNemotronRuntimeAvailabilitySummary(availabilityAfterStart),
    'availabilityAfterStop': availabilityAfterStop == null
        ? null
        : coreMlNemotronRuntimeAvailabilitySummary(availabilityAfterStop),
    'asrSent': asrSent,
    'asrSendStarted': asrSendStarted,
    'translationFinal': translationFinal,
    'expectTranslation': expectTranslation,
    'serverOwnedHistory': serverOwnedHistory,
    'durationSeconds': durationSeconds,
    'segmentCount': drafts.length,
    'error': runError?.toString(),
    'stopError': stopError?.toString(),
    'endError': endError?.toString(),
    'asrSendError': asrSendError?.toString(),
    'translationError': translationError?.toString(),
    'historyError': historyError?.toString(),
    'audioCaptureError': audioCaptureError,
    'apiHealthError': apiHealthError?.toString(),
    'apiHealthOk': apiHealthOk,
    'apiHealthService': apiHealthService,
    'apiHealthRealtimeWsEndpoint': apiHealthRealtimeWsEndpoint,
    'gatewayHealth': gatewayHealth?.toJson(),
    'historyDetailLoaded': historyDetailLoaded,
    'historySaved': historySaved,
    'historySegmentCount': historySegmentCount,
    'historyStatus': historyStatus,
    'segments': draftSegmentSummaries(drafts),
  };
}

List<Map<String, Object?>> draftSegmentSummaries(
  Map<String, GatewayE2eSegmentDraft> drafts,
) {
  return drafts.entries.map((entry) {
    return <String, Object?>{
      'id': entry.key,
      'sourceCharCount': entry.value.sourceText.length,
      'translatedCharCount': entry.value.translatedText.length,
    };
  }).toList();
}

Future<Map<String, Object?>> fetchApiHealth(Uri baseUrl) async {
  final response = await http
      .get(baseUrl.resolve('/health'))
      .timeout(const Duration(seconds: 8));
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw StateError('API /health failed: ${response.statusCode}');
  }
  return jsonDecode(response.body) as Map<String, Object?>;
}

Future<GatewayHealthResult> fetchGatewayHealthFromApiHealth(
  Map<String, Object?> apiHealth,
) async {
  final endpoint = apiHealth['realtimeWsEndpoint'];
  if (endpoint is! String || endpoint.isEmpty) {
    return const GatewayHealthResult(
      ok: false,
      error: 'API /health did not expose realtimeWsEndpoint',
    );
  }
  try {
    final response = await http
        .get(_gatewayHealthUri(endpoint))
        .timeout(const Duration(seconds: 8));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return GatewayHealthResult(
        ok: false,
        error: 'Gateway /health failed: ${response.statusCode}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return GatewayHealthResult(
      ok: true,
      service: json['service'] as String?,
      provider: json['provider'] as String?,
      asrProvider: json['asrProvider'] as String?,
      sessionEventSink: json['sessionEventSink'] as String?,
    );
  } catch (error) {
    return GatewayHealthResult(ok: false, error: error.toString());
  }
}

Future<SessionDetail> waitForHistoryDetail(
  SessionHistoryApiClient client,
  String sessionId, {
  required bool requireSavedSegment,
  required bool requireEnded,
}) async {
  final deadline = DateTime.now().add(const Duration(seconds: 8));
  Object? lastError;
  SessionDetail? lastDetail;
  while (DateTime.now().isBefore(deadline)) {
    try {
      final detail = await client.getSession(sessionId);
      lastDetail = detail;
      final hasRequiredSegment =
          !requireSavedSegment || _hasSavedSegment(detail);
      final hasRequiredStatus = !requireEnded || detail.status == 'ended';
      if (hasRequiredSegment && hasRequiredStatus) return detail;
    } catch (error) {
      lastError = error;
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }
  if (lastDetail != null) return lastDetail;
  if (lastError != null) throw lastError;
  return client.getSession(sessionId);
}

Map<String, Object?> segmentMeta(AsrTextSegment segment) {
  return <String, Object?>{
    'id': segment.id,
    'language': segment.language,
    'isFinal': segment.isFinal,
    'charCount': segment.text.length,
    'confidence': segment.confidence,
  };
}

bool _hasSavedSegment(SessionDetail detail) {
  return detail.segments.any((segment) {
    return segment.sourceText.trim().isNotEmpty ||
        segment.translatedText.trim().isNotEmpty;
  });
}

Map<String, Object?> errorToJson(Object error) {
  return <String, Object?>{
    'type': error.runtimeType.toString(),
    'message': error.toString(),
  };
}

Uri _gatewayHealthUri(String realtimeWsEndpoint) {
  final uri = Uri.parse(realtimeWsEndpoint);
  final scheme = uri.scheme == 'wss' ? 'https' : 'http';
  return uri.replace(scheme: scheme, path: '/health', query: '');
}
