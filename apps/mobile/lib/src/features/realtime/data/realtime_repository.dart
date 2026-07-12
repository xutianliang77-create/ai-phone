import 'dart:async';

import '../../../app/app_config.dart';
import '../../../platform/audio/audio_frame.dart';
import '../../../platform/asr/asr_text_segment.dart';
import '../domain/entities/subtitle_segment.dart';
import 'api/realtime_api_client.dart';
import 'api/realtime_session.dart';
import 'gateway/gateway_realtime_event.dart';
import 'gateway/realtime_gateway_client.dart';

class RealtimeRepository {
  RealtimeRepository({
    required RealtimeApiClient apiClient,
    required RealtimeGatewayClient gatewayClient,
    bool appPersistsSessionOnEnd = true,
    String targetLanguage = 'zh',
  })  : _apiClient = apiClient,
        _appPersistsSessionOnEnd = appPersistsSessionOnEnd,
        _gatewayClient = gatewayClient,
        _targetLanguage = targetLanguage;

  factory RealtimeRepository.fromConfig(AppConfig config) {
    final autoReverseTargetLanguage = shouldAutoReverseRealtimeSession(config);
    return RealtimeRepository(
      apiClient: RealtimeApiClient(
        baseUrl: config.apiBaseUrl,
        mode: config.realtimeMode,
        sourceLanguage: config.sourceLanguage,
        targetLanguage: config.targetLanguage,
        autoReverseTargetLanguage: autoReverseTargetLanguage,
        voiceOutputMode: config.realtimeVoiceOutputMode,
      ),
      gatewayClient: RealtimeGatewayClient(),
      appPersistsSessionOnEnd:
          config.useOnDeviceTranslation || !config.serverOwnedHistory,
      targetLanguage: config.targetLanguage,
    );
  }

  final RealtimeApiClient _apiClient;
  final RealtimeGatewayClient _gatewayClient;
  final bool _appPersistsSessionOnEnd;
  final String _targetLanguage;
  final Map<String, Future<void>> _finalizations = {};
  bool _disposeRequested = false;

  Stream<GatewayRealtimeEvent> get events => _gatewayClient.events;

  Future<RealtimeSession> startSession() async {
    final session = await _apiClient.createSession();
    try {
      await _gatewayClient.connect(session);
      return session;
    } catch (_) {
      unawaited(
          _apiClient.endSession(session.sessionId).catchError((Object _) {}));
      rethrow;
    }
  }

  bool sendAudio(String sessionId, AudioFrame frame) {
    return _gatewayClient.sendAudio(sessionId, frame);
  }

  bool sendTextSegment(String sessionId, AsrTextSegment segment) {
    return _gatewayClient.sendTextSegment(
      sessionId,
      segment,
      fallbackTargetLanguage: _targetLanguage,
    );
  }

  bool pause(String sessionId) {
    return _gatewayClient.pause(sessionId);
  }

  Future<bool> pauseAndWait(String sessionId) {
    return _gatewayClient.pauseAndWait(sessionId);
  }

  bool resume(String sessionId) {
    return _gatewayClient.resume(sessionId);
  }

  Future<bool> resumeAndWait(String sessionId) {
    return _gatewayClient.resumeAndWait(sessionId);
  }

  Future<void> end(String sessionId, List<SubtitleSegment> segments) {
    return _finalizations.putIfAbsent(
      sessionId,
      () => _endOnce(sessionId, segments),
    );
  }

  Future<void> _endOnce(
    String sessionId,
    List<SubtitleSegment> segments,
  ) async {
    final flushConfirmed = await _gatewayClient.endAndWait(sessionId);
    if (_appPersistsSessionOnEnd) {
      await _apiClient.saveSegments(
        sessionId,
        segments
            .where((segment) =>
                segment.sourceText.trim().isNotEmpty ||
                segment.translatedText.trim().isNotEmpty)
            .map(_segmentToJson)
            .toList(),
      );
      await _apiClient.endSession(sessionId);
    }
    if (!flushConfirmed) {
      throw const RealtimeFinalizationException(
        '最后一句处理未完整确认，现有原文和译文已保留',
      );
    }
  }

  Future<void> closeRealtime() async {
    await _gatewayClient.close();
  }

  void dispose() {
    if (_disposeRequested) return;
    _disposeRequested = true;
    final pending = _finalizations.values.toList(growable: false);
    if (pending.isEmpty) {
      _disposeClients();
      return;
    }
    unawaited(_disposeAfterFinalization(pending));
  }

  Future<void> _disposeAfterFinalization(List<Future<void>> pending) async {
    try {
      await Future.wait(pending);
    } catch (_) {
      // Finalization is best effort during teardown.
    } finally {
      _disposeClients();
    }
  }

  void _disposeClients() {
    _gatewayClient.dispose();
    _apiClient.close();
  }
}

class RealtimeFinalizationException implements Exception {
  const RealtimeFinalizationException(this.message);

  final String message;

  @override
  String toString() => message;
}

bool shouldAutoReverseRealtimeSession(AppConfig config) {
  if (config.autoReverseTargetLanguage) return true;
  if (config.realtimeMode != 'conversation') return false;
  return (config.sourceLanguage == 'zh' && config.targetLanguage == 'en') ||
      (config.sourceLanguage == 'en' && config.targetLanguage == 'zh');
}

Map<String, Object?> _segmentToJson(SubtitleSegment segment) {
  return {
    'id': segment.id,
    'sourceText': segment.sourceText,
    if (segment.rawText != null) 'rawText': segment.rawText,
    if (segment.optimizedText != null) 'optimizedText': segment.optimizedText,
    'translatedText': segment.translatedText,
    if (segment.sourceLanguage != null)
      'sourceLanguage': segment.sourceLanguage,
    if (segment.targetLanguage != null)
      'targetLanguage': segment.targetLanguage,
    if (segment.confidence != null) 'confidence': segment.confidence,
    if (segment.stage != null) 'stage': segment.stage,
    if (segment.provider != null) 'provider': segment.provider,
    if (segment.model != null) 'model': segment.model,
    if (segment.latencyMs != null) 'latencyMs': segment.latencyMs,
    if (segment.refinement != null) 'refinement': segment.refinement,
    if (segment.languageProfile != null) ...segment.languageProfile!.toJson(),
    if (segment.speaker != null) 'speaker': segment.speaker!.toJson(),
    if (segment.timing != null) 'timing': segment.timing!.toJson(),
  };
}
