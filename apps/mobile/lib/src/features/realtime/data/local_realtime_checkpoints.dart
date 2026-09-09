part of 'local_realtime_repository.dart';

extension LocalRealtimeCheckpoints on LocalRealtimeRepository {
  Future<void> _saveLocalSnapshot(
      String sessionId, List<SubtitleSegment> segments,
      {required String status}) {
    final created = _createdAt[sessionId];
    if (created == null || sessionId != _activeId) {
      return Future.error(StateError('Unknown local session'));
    }
    final now = _now();
    final committed = segments
        .where((s) =>
            s.sourceText.trim().isNotEmpty ||
            s.translatedText.trim().isNotEmpty)
        .map(SessionSegment.fromSubtitle)
        .toList();
    final record = LocalSessionCheckpoint(
        deploymentId: deviceLocalDeployment,
        ownerId: deviceLocalOwner,
        revision: ++_revision,
        snapshot: SessionDetail(
            sessionId: sessionId,
            mode: _mode,
            status: status,
            createdAt: created,
            endedAt: status == 'ended' ? now : null,
            consumedSeconds:
                (_activeSeconds ?? now.difference(created).inSeconds)
                    .clamp(0, 86400),
            segmentCount: committed.length,
            segments: committed,
            sourceLanguage: _source,
            targetLanguage: _target,
            kind: 'realtime'));
    final body = record.toJson()..remove('revision');
    final fingerprint = jsonEncode(body);
    if (fingerprint == _fingerprint) return _writer ?? Future<void>.value();
    _fingerprint = fingerprint;
    // At most one immutable write plus one latest snapshot. Partial updates
    // cannot create an unbounded list of file operations or upload intents.
    _pending = record;
    if (_writer != null) return _writer!;
    final done = Completer<void>();
    _writer = done.future;
    Future<void>(() async {
      try {
        while (_pending != null) {
          final next = _pending!;
          _pending = null;
          await _store.putCheckpoint(next);
        }
        done.complete();
      } catch (error, stack) {
        _fingerprint = null;
        done.completeError(error, stack);
      } finally {
        _writer = null;
      }
    });
    return done.future;
  }
}
