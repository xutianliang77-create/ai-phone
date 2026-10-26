import 'dart:async';

import '../../../platform/audio/audio_frame.dart';
import '../../../platform/asr/asr_text_segment.dart';
import '../../history/data/local_session_store.dart';
import '../../history/data/owned_local_session_store.dart';
import '../domain/entities/subtitle_segment.dart';
import 'api/realtime_api_client.dart';
import 'api/realtime_session.dart';
import 'gateway/gateway_realtime_event.dart';
import 'gateway/realtime_gateway_client.dart';
import 'realtime_repository.dart';
import '../../../platform/license/on_device_license.dart';

class LocalRealtimeRepository extends RealtimeRepository {
  LocalRealtimeRepository({
    required LocalSessionStore store,
    DateTime Function()? now,
    OnDeviceLicense? license,
  })  : _store = store,
        _license = license,
        _now = now ?? DateTime.now,
        super(
          apiClient: RealtimeApiClient(baseUrl: Uri.parse('http://127.0.0.1')),
          gatewayClient: RealtimeGatewayClient(),
        );

  final LocalSessionStore _store;
  final OnDeviceLicense? _license;
  StreamSubscription<void>? _licenseEvents;
  final DateTime Function() _now;
  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final Map<String, DateTime> _createdAt = <String, DateTime>{};
  final _sessionStores = <String, LocalSessionStore>{};

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    final license = await _license?.ensureValid();
    if (_license != null && license?.valid != true) throw StateError('authorization_required');
    final createdAt = _now();
    final sessionId = 'local_${createdAt.microsecondsSinceEpoch}';
    _createdAt[sessionId] = createdAt;
    _sessionStores[sessionId] = _store is OwnedLocalSessionStore
      ? await _store.pin() : _store;
    if (_license != null) {
      await _licenseEvents?.cancel();
      _licenseEvents = _license.invalidations.listen((_) {
        _events.addError(StateError('本次离线授权已到期，请联网核对订阅；套餐到期请购买。'));
      });
      await _license.activity(sessionId, true);
    }
    return RealtimeSession(
      sessionId: sessionId,
      realtimeToken: license?.leaseId ?? 'local',
      endpoint: Uri.parse('local://realtime'),
      expiresAt: createdAt.add(Duration(milliseconds: license?.remainingMs ?? 3600000)),
      // Native membership renewal owns its hard cutoff; this field is not a
      // renewable DateTime deadline in the on-device product.
      maxDurationSeconds: license == null ? 3600 : 0,
    );
  }

  @override
  bool sendAudio(String sessionId, AudioFrame frame) => false;

  @override
  bool sendTextSegment(String sessionId, AsrTextSegment segment) => false;

  @override
  bool pause(String sessionId) => true;

  @override
  Future<bool> pauseAndWait(String sessionId) async {
    await _license?.activity(sessionId, false); return true;
  }

  @override
  bool resume(String sessionId) => true;

  @override
  Future<void> suspendForLifecycle() async {}

  @override
  Future<bool> resumeAfterLifecycle(String sessionId) async => resumeAndWait(sessionId);

  @override
  Future<bool> resumeAndWait(String sessionId) async {
    await _license?.ensureValid(); await _license?.activity(sessionId, true); return true;
  }

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    final boundStore = _sessionStores[sessionId], created = _createdAt[sessionId];
    if (boundStore == null || created == null) return;
    await _license?.activity(sessionId, false).catchError((Object _) {});
    await boundStore.saveEndedSession(
      sessionId: sessionId,
      createdAt: created,
      segments: segments,
    );
    _createdAt.remove(sessionId);
    _sessionStores.remove(sessionId);
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
    unawaited(_licenseEvents?.cancel());
    unawaited(_events.close());
    super.dispose();
  }
}
