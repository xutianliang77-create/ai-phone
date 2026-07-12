part of 'realtime_controller.dart';

extension RealtimeControllerStop on RealtimeController {
  Future<void> stop() async {
    if (_stopInFlight || isTerminalRealtimeStatus(_status)) return;
    _stopInFlight = true;
    final pendingStart =
        _status == RealtimeStatus.connecting ? _startCompletion : null;
    _startGeneration += 1;
    if (!_setStatus(RealtimeStatus.ending)) {
      _stopInFlight = false;
      return;
    }
    try {
      await pendingStart;
      final session = _session;
      await ignoreCleanupError(_audioCapture.stop);
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      await ignoreCleanupError(() async => _audioSubscription?.cancel());
      await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
      await ignoreCleanupError(_stopSpeaking);
      await _drainDeviceAsrStopEvents();
      await _flushPendingLocalPartialTranslation();
      await ignoreCleanupError(() async => _asrSubscription?.cancel());
      _sessionTimeoutTimer?.cancel();
      _audioSubscription = null;
      _asrSubscription = null;
      _resumeAfterLifecyclePause = false;
      _setStatus(RealtimeStatus.ended);
      if (session != null) {
        try {
          await _repository.end(session.sessionId, _segments);
        } catch (error) {
          _message = error.toString();
          _notify();
        }
      }
      _session = null;
    } finally {
      _stopInFlight = false;
    }
  }
}
