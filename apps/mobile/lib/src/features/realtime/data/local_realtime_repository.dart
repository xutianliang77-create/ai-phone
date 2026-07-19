import 'dart:async';

import '../../../platform/audio/audio_frame.dart';
import '../../../platform/asr/asr_text_segment.dart';
import '../../history/data/local_session_store.dart';
import '../domain/entities/subtitle_segment.dart';
import 'api/realtime_api_client.dart';
import 'api/realtime_session.dart';
import 'gateway/gateway_realtime_event.dart';
import 'gateway/realtime_gateway_client.dart';
import 'realtime_repository.dart';

class LocalRealtimeRepository extends RealtimeRepository {
  LocalRealtimeRepository({
    required LocalSessionStore store,
    DateTime Function()? now,
  })  : _store = store,
        _now = now ?? DateTime.now,
        super(
          apiClient: RealtimeApiClient(baseUrl: Uri.parse('http://127.0.0.1')),
          gatewayClient: RealtimeGatewayClient(),
        );

  final LocalSessionStore _store;
  final DateTime Function() _now;
  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final Map<String, DateTime> _createdAt = <String, DateTime>{};

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    final createdAt = _now();
    final sessionId = 'local_${createdAt.microsecondsSinceEpoch}';
    _createdAt[sessionId] = createdAt;
    return RealtimeSession(
      sessionId: sessionId,
      realtimeToken: 'local',
      endpoint: Uri.parse('local://realtime'),
      expiresAt: createdAt.add(const Duration(hours: 1)),
      maxDurationSeconds: 3600,
    );
  }

  @override
  bool sendAudio(String sessionId, AudioFrame frame) => false;

  @override
  bool sendTextSegment(String sessionId, AsrTextSegment segment) => false;

  @override
  bool pause(String sessionId) => true;

  @override
  Future<bool> pauseAndWait(String sessionId) async => true;

  @override
  bool resume(String sessionId) => true;

  @override
  Future<void> suspendForLifecycle() async {}

  @override
  Future<bool> resumeAfterLifecycle(String sessionId) async => true;

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    await _store.saveEndedSession(
      sessionId: sessionId,
      createdAt: _createdAt[sessionId] ?? _now(),
      segments: segments,
    );
    _createdAt.remove(sessionId);
  }

  @override
  Future<void> prepareFinalization(
    String sessionId,
    List<SubtitleSegment> segments, {
    int? billableSeconds,
  }) async {}

  @override
  Future<void> recoverPendingFinalizations() async {}

  @override
  Future<void> closeRealtime() async {}

  @override
  void dispose() {
    unawaited(_events.close());
    super.dispose();
  }
}
