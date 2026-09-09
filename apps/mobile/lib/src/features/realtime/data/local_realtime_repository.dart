import 'dart:async';
import 'dart:convert';

import '../../../platform/audio/audio_frame.dart';
import '../../../platform/asr/asr_text_segment.dart';
import '../../history/data/local_session_store.dart';
import '../../history/data/session_history_models.dart';
import '../domain/entities/subtitle_segment.dart';
import 'api/realtime_api_client.dart';
import 'api/realtime_session.dart';
import 'gateway/gateway_realtime_event.dart';
import 'gateway/realtime_gateway_client.dart';
import 'realtime_repository.dart';

part 'local_realtime_checkpoints.dart';

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
  static int _serial = 0;
  String? _activeId, _fingerprint;
  String _mode = 'conversation', _source = 'auto', _target = 'zh';
  int _revision = 0;
  int? _activeSeconds;
  bool _closed = false;
  LocalSessionCheckpoint? _pending;
  Future<void>? _writer, _endFuture;

  @override
  bool get supportsLocalCheckpoints => true;

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    if (_writer != null) await _writer!.timeout(const Duration(seconds: 2));
    final createdAt = _now();
    final sessionId = 'local_${createdAt.microsecondsSinceEpoch}_${++_serial}';
    _createdAt.clear();
    _activeId = sessionId;
    _revision = 0;
    _activeSeconds = null;
    _closed = false;
    _pending = null;
    _fingerprint = null;
    _endFuture = null;
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
  Future<bool> resumeAndWait(String sessionId) async => true;

  @override
  Future<void> suspendForLifecycle() async {}

  @override
  Future<bool> resumeAfterLifecycle(String sessionId) async => true;

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) {
    if (sessionId != _activeId) {
      return Future.error(StateError('Unknown local session'));
    }
    if (_endFuture != null) return _endFuture!;
    _closed = true;
    return _endFuture =
        _saveLocalSnapshot(sessionId, segments, status: 'ended');
  }

  @override
  Future<void> prepareFinalization(
    String sessionId,
    List<SubtitleSegment> segments, {
    int? billableSeconds,
  }) {
    _activeSeconds = billableSeconds ?? _activeSeconds;
    if (_closed) return _endFuture ?? Future<void>.value();
    return _saveLocalSnapshot(sessionId, segments, status: 'ending');
  }

  @override
  Future<void> checkpoint(
    String sessionId,
    List<SubtitleSegment> segments, {
    required String mode,
    required String status,
    required String sourceLanguage,
    required String targetLanguage,
    required int activeSeconds,
  }) {
    if (_closed || sessionId != _activeId) return Future<void>.value();
    _mode = mode;
    _source = sourceLanguage;
    _target = targetLanguage;
    _activeSeconds = activeSeconds;
    return _saveLocalSnapshot(sessionId, segments, status: status);
  }

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
