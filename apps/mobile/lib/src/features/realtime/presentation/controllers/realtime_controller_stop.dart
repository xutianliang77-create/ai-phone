part of 'realtime_controller.dart';

extension RealtimeControllerStop on RealtimeController {
  Future<void> stop() async {
    if (_stopInFlight || _status == RealtimeStatus.ended) return;
    _stopInFlight = true;
    final session = _session;
    _setStatus(RealtimeStatus.ended);
    try {
      await ignoreCleanupError(_audioCapture.stop);
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
          await _repository.end(session.sessionId, segments);
        } catch (error) {
          _message = error.toString();
          _notify();
        }
      }
      _session = null;
      _resumeAfterLifecyclePause = false;
    } finally {
      _stopInFlight = false;
    }
  }
}
