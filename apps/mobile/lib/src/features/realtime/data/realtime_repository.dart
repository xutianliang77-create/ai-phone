import 'dart:async';
import 'dart:convert';
import '../../../app/app_config.dart';
import '../../../platform/audio/audio_frame.dart';
import '../../../platform/asr/asr_text_segment.dart';
import '../domain/entities/subtitle_segment.dart';
import 'api/realtime_api_client.dart';
import 'api/realtime_session.dart';
import 'api/public_creation_resolution.dart';
import 'finalization/realtime_finalization_outbox.dart';
import 'finalization/realtime_finalization_task.dart';
import 'gateway/gateway_realtime_event.dart';
import 'gateway/realtime_gateway_client.dart';
import '../../history/data/local_session_store.dart';
import '../../history/data/session_history_models.dart';
import 'finalization/result_sync_receipt.dart';

part 'realtime_result_sync.dart';
part 'realtime_repository_start.dart';
part 'realtime_public_lifecycle.dart';

class RealtimeRepository {
  RealtimeRepository({
    required RealtimeApiClient apiClient,
    required RealtimeGatewayClient gatewayClient,
    RealtimeFinalizationOutbox? finalizationOutbox,
    DateTime Function()? now,
    String targetLanguage = 'zh',
    LocalSessionStore? resultSyncStore,
  })  : _apiClient = apiClient,
        _gatewayClient = gatewayClient,
        _finalizationOutbox =
            finalizationOutbox ?? MemoryRealtimeFinalizationOutbox(),
        _now = now ?? DateTime.now,
        _targetLanguage = targetLanguage,
        _resultSyncStore = resultSyncStore ?? LocalSessionStore();

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
        voicePresetId: config.realtimeVoicePresetId,
        domainLexiconPack: config.domainLexiconPack,
      ),
      gatewayClient: RealtimeGatewayClient(),
      finalizationOutbox: FileRealtimeFinalizationOutbox(),
      targetLanguage: config.targetLanguage,
    );
  }

  final RealtimeApiClient _apiClient;
  final RealtimeGatewayClient _gatewayClient;
  final RealtimeFinalizationOutbox _finalizationOutbox;
  final DateTime Function() _now;
  final String _targetLanguage;
  final LocalSessionStore _resultSyncStore;
  final _ResultSyncState _resultSync = _ResultSyncState();
  final Map<String, Future<void>> _finalizations = {};
  Future<void>? _replayInFlight;
  bool _disposeRequested = false;
  int _startEpoch = 0;
  Future<RealtimeSession>? _publicStart;
  Stream<GatewayRealtimeEvent> get events => _gatewayClient.events;

  bool get supportsLocalCheckpoints => false;
  Future<void> checkpoint(
    String sessionId,
    List<SubtitleSegment> segments, {
    required String mode,
    required String status,
    required String sourceLanguage,
    required String targetLanguage,
    required int activeSeconds,
  }) async {}

  Future<RealtimeSession> startSession() async {
    if (_disposeRequested) throw StateError('Realtime repository disposed');
    if (publicLifecycleConfigured) {
      final running = _publicStart;
      if (running != null) return running;
      final future = _startSessionOnce(++_startEpoch);
      _publicStart = future;
      try {
        return await future;
      } finally {
        if (identical(_publicStart, future)) _publicStart = null;
      }
    }
    return _startSessionOnce(++_startEpoch);
  }

  bool sendAudio(String sessionId, AudioFrame frame) {
    return _gatewayClient.sendAudio(sessionId, frame);
  }

  Future<bool> commitAudioBoundary(String sessionId) =>
      _gatewayClient.commitAudioBoundaryAndWait(sessionId);

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
    if (_apiClient.publicDeploymentId.isNotEmpty) {
      return resumePublicSession(sessionId, reconnect: false);
    }
    return _gatewayClient.resumeAndWait(sessionId);
  }

  Future<void> setVoiceOutput(String sessionId, bool enabled,
      {String? presetId}) {
    return _gatewayClient.setVoiceOutput(sessionId, enabled,
        presetId: presetId);
  }

  void configureVoiceOutput(String mode) => _apiClient.setVoiceOutputMode(mode);

  Future<void> suspendForLifecycle() {
    return _gatewayClient.suspendForLifecycle();
  }

  Future<bool> resumeAfterLifecycle(String sessionId) {
    if (_apiClient.publicDeploymentId.isNotEmpty) {
      return resumeRetainedPublicSession(sessionId);
    }
    return _gatewayClient.reconnectAndResume(sessionId);
  }

  Future<void> end(String sessionId, List<SubtitleSegment> segments) {
    invalidateResultSync();
    if (_apiClient.publicDeploymentId.isNotEmpty) {
      return Future.error(
          const RealtimeApiException('公有会话可信结算尚未就绪', statusCode: 503));
    }
    return _finalizations.putIfAbsent(
      sessionId,
      () => _endOnce(sessionId, segments),
    );
  }

  Future<void> _endOnce(
    String sessionId,
    List<SubtitleSegment> segments,
  ) async {
    await prepareFinalization(sessionId, segments);
    var flushConfirmed = false;
    try {
      flushConfirmed = await _gatewayClient.endAndWait(sessionId);
    } catch (_) {
      // The durable API finalization below remains authoritative offline.
    }
    await prepareFinalization(sessionId, segments);
    await _replaySession(sessionId);
    if (!flushConfirmed) {
      throw const RealtimeFinalizationException(
        '最后一句处理未完整确认，现有原文和译文已保留',
      );
    }
  }

  Future<void> prepareFinalization(
    String sessionId,
    List<SubtitleSegment> segments, {
    int? billableSeconds,
  }) async {
    if (_apiClient.publicDeploymentId.isNotEmpty) {
      throw const RealtimeApiException('公有会话可信结算尚未就绪', statusCode: 503);
    }
    await _finalizationOutbox.upsert(RealtimeFinalizationTask(
      sessionId: sessionId,
      idempotencyKey: 'finalize:$sessionId',
      segments: _snapshotSegments(segments),
      billableSeconds: billableSeconds ?? 0,
      createdAt: _now(),
    ));
  }

  Future<void> recoverPendingFinalizations() async {
    if (_apiClient.publicDeploymentId.isNotEmpty) return;
    final running = _replayInFlight;
    if (running != null) return running;
    final replay = _replayAll();
    _replayInFlight = replay;
    try {
      await replay;
    } finally {
      if (identical(_replayInFlight, replay)) _replayInFlight = null;
    }
  }

  Future<void> _replayAll() async {
    final tasks = await _finalizationOutbox.load();
    await Future.wait(tasks.map(_finalizeTask));
  }

  Future<void> _replaySession(String sessionId) async {
    final tasks = await _finalizationOutbox.load();
    final task = _taskForSession(tasks, sessionId);
    if (task == null) return;
    final finalized = await _finalizeTask(task);
    if (!finalized) {
      throw const RealtimeFinalizationException(
        '服务器已不存在该会话，现有原文和译文已转入恢复记录',
      );
    }
  }

  Future<bool> _finalizeTask(RealtimeFinalizationTask task) async {
    try {
      await _apiClient.finalizeSession(
        sessionId: task.sessionId,
        segments: task.segments,
        billableSeconds: task.billableSeconds,
        idempotencyKey: task.idempotencyKey,
      );
    } on RealtimeApiException catch (error) {
      if (error.statusCode != 404) rethrow;
      await _finalizationOutbox.quarantine(
        task,
        reason: 'http_404_session_not_found',
        quarantinedAt: _now(),
      );
      return false;
    }
    await _finalizationOutbox.remove(task.sessionId);
    return true;
  }

  Future<void> closeRealtime() async {
    cancelPendingStart();
    await _gatewayClient.close();
  }

  void cancelPendingStart() {
    _startEpoch++;
    _apiClient.cancelPublicCreationWait();
    if (_publicStart != null) unawaited(_gatewayClient.close());
  }

  void dispose() {
    cancelPendingStart();
    invalidateResultSync();
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
    if (segment.vadContext != null) 'vadContext': segment.vadContext,
  };
}

List<Map<String, Object?>> _snapshotSegments(
  List<SubtitleSegment> segments,
) {
  return segments
      .where((segment) =>
          segment.sourceText.trim().isNotEmpty ||
          segment.translatedText.trim().isNotEmpty)
      .map(_segmentToJson)
      .toList(growable: false);
}

RealtimeFinalizationTask? _taskForSession(
  List<RealtimeFinalizationTask> tasks,
  String sessionId,
) {
  for (final task in tasks) {
    if (task.sessionId == sessionId) return task;
  }
  return null;
}
