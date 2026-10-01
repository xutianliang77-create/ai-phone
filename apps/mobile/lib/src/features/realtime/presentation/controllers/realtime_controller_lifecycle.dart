part of 'realtime_controller.dart';

extension RealtimeControllerLifecycle on RealtimeController {
  void _startSessionTimeout(RealtimeSession session) {
    _sessionTimeoutTimer?.cancel();
    // Online public sessions are governed by server budget/availability. The
    // client must not enforce or expose a free-quota-derived duration cap.
    if (session.syncBinding != null || session.maxDurationSeconds == null) {
      _sessionTimeoutTimer = null;
      return;
    }
    _sessionTimeoutTimer = Timer(
      Duration(seconds: session.maxDurationSeconds!),
      () async {
        _message = 'Session time limit reached';
        await stop();
      },
    );
  }

  Future<void> handleLifecycleState(AppLifecycleState state) {
    // iOS sends inactive/paused/resumed without awaiting the preceding async
    // notification. Keep pause/ACK/suspend ahead of resume on the SAME session.
    // Explicit stop/dispose remains immediate and invalidates queued work.
    if (state == AppLifecycleState.detached) {
      _resumeAfterLifecyclePause = false;
      return stop();
    }
    final session = _session, generation = _startGeneration;
    final work = _lifecycleWork.then((_) async {
      if (_disposed || generation != _startGeneration ||
          !identical(_session, session)) { return; }
      await _applyLifecycleState(state);
    });
    _lifecycleWork = work.catchError((Object _) {});
    return work;
  }

  Future<void> _applyLifecycleState(AppLifecycleState state) async {
    if (state == AppLifecycleState.resumed && _resumeAfterLifecyclePause) {
      _resumeAfterLifecyclePause = false;
      await _resumeAfterLifecycleOrFail();
      return;
    }
    if ((state == AppLifecycleState.inactive ||
            state == AppLifecycleState.paused) &&
        _status == RealtimeStatus.active) {
      _resumeAfterLifecyclePause = true;
      await pause();
      if (_status == RealtimeStatus.paused) {
        await _repository.suspendForLifecycle();
      }
    }
  }

  Future<void> disposeAsync() => _disposeFuture??=_disposeOnce();
  Future<void> _disposeOnce() async {
    await cancelLocalResourcePreparation();
    if (!isTerminalRealtimeStatus(_status)) await stop();
    await _failureCleanup?.catchError((Object _) {});
    await ignoreCleanupError(() async => _eventSubscription?.cancel());
    await ignoreCleanupError(() async => _audioSubscription?.cancel());
    await ignoreCleanupError(() async => _asrSubscription?.cancel());
    await ignoreCleanupError(() async => _audioSessionSubscription?.cancel());
    await ignoreCleanupError(_audioCapture.dispose);
    await ignoreCleanupError(_audioSessionCoordinator.endCapture);
    await ignoreCleanupError(() async => _mobileAsrProvider?.dispose());
    await ignoreCleanupError(() async => _mobileTranslationProvider?.dispose());
    await ignoreCleanupError(_stopSpeaking);
    await ignoreCleanupError(_audioSessionCoordinator.dispose);
    _repository.dispose();
  }
}
