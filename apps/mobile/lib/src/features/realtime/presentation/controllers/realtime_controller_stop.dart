part of 'realtime_controller.dart';

extension RealtimeControllerStop on RealtimeController {
  Future<void> stop() async {
    if (_stopInFlight || isTerminalRealtimeStatus(_status)) return;
    _stopInFlight = true;
    final session = _session;
    if (!_setStatus(RealtimeStatus.ending)) {
      _stopInFlight = false;
      return;
    }
    try {
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
      if (session != null) {
        try {
          await _repository.end(session.sessionId, _segments);
        } catch (error) {
          _message = error.toString();
          _notify();
        }
      }
      _session = null;
      _resumeAfterLifecyclePause = false;
      _setStatus(RealtimeStatus.ended);
    } finally {
      _stopInFlight = false;
    }
  }
}
