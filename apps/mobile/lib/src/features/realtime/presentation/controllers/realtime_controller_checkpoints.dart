part of 'realtime_controller.dart';

extension RealtimeControllerCheckpoints on RealtimeController {
  bool get _usesLocalCheckpoints =>
      _config.useLocalSessions && _repository.supportsLocalCheckpoints;

  void _scheduleLocalCheckpoint() {
    final session = _session;
    if (!_usesLocalCheckpoints ||
        session == null ||
        ![RealtimeStatus.active, RealtimeStatus.paused, RealtimeStatus.ending]
            .contains(_status)) {
      return;
    }
    late final Future<void> future;
    try {
      future = _repository.checkpoint(session.sessionId, _finalizationSegments,
          mode: _config.realtimeMode,
          status: _status.name,
          sourceLanguage: _config.sourceLanguage,
          targetLanguage: _config.targetLanguage,
          activeSeconds: _activeTimeClock.billableSeconds);
    } catch (error, stack) {
      future = Future<void>.error(error, stack);
    }
    if (identical(future, _checkpointFuture)) return;
    _checkpointFuture = future;
    unawaited(future.timeout(const Duration(seconds: 2)).then((_) {
      if (identical(_session, session) &&
          !_disposed &&
          identical(_checkpointFuture, future)) {
        _checkpointWarning = null;
        _notify();
      }
    }, onError: (Object _) {
      if (identical(_session, session) &&
          !_disposed &&
          identical(_checkpointFuture, future)) {
        _checkpointWarning = '本地快照保存未确认，请勿退出；已提交记录仍保留';
        _notify();
      }
    }));
  }

  Future<void> _awaitLocalCheckpoint() async {
    if (!_usesLocalCheckpoints) return;
    try {
      await _checkpointFuture?.timeout(const Duration(seconds: 2));
    } catch (_) {
      _checkpointWarning = '本地快照保存未确认，请勿退出；已提交记录仍保留';
      _notify();
    }
  }

  Future<bool> _drainLocalCheckpointTail() async {
    try {
      await (() async {
        await _drainAsrTextSegments();
        await _flushPendingLocalPartialTranslation();
      })()
          .timeout(const Duration(seconds: 3));
      return true;
    } catch (_) {
      _localTailClosed = true;
      _localPartialFlush.cancel();
      return false;
    }
  }

  Future<void> _saveFailedLocalCheckpoint(RealtimeSession session) async {
    try {
      await (() async {
        final preparing = _repository.prepareFinalization(
            session.sessionId, _finalizationSegments,
            billableSeconds: _activeTimeClock.billableSeconds);
        // Queue the terminal snapshot before waiting on disk. A timed-out
        // earlier write must not enqueue an old end after a new session starts.
        final ending = _repository.end(session.sessionId, _finalizationSegments);
        await Future.wait([preparing, ending]);
      })()
          .timeout(const Duration(seconds: 3));
    } catch (_) {
      _checkpointWarning = '本地保存未确认，历史可能仅有先前快照';
    }
  }

  Future<void> _finishLocalCheckpoint(RealtimeSession session,
      {bool tailComplete = true}) async {
    try {
      await (() async {
        final preparing = _repository.prepareFinalization(
            session.sessionId, _finalizationSegments,
            billableSeconds: _activeTimeClock.billableSeconds);
        // Queue the terminal snapshot before waiting on disk. A timed-out
        // earlier write must not enqueue an old end after a new session starts.
        final ending = _repository.end(session.sessionId, _finalizationSegments);
        await Future.wait([preparing, ending]);
      })()
          .timeout(const Duration(seconds: 3));
      _checkpointWarning = tailComplete ? null : '尾句处理未完整确认，已提交的原文和译文已保存';
    } catch (_) {
      _checkpointWarning = '本地结束保存未确认，历史可能仅有先前快照；请勿退出';
    }
    _setStatus(RealtimeStatus.ended);
    _session = null;
    _notify();
  }
}
