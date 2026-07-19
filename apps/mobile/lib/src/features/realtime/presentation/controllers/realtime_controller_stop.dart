part of 'realtime_controller.dart';

extension RealtimeControllerStop on RealtimeController {
  Future<void> stop() async {
    if (_stopInFlight || isTerminalRealtimeStatus(_status)) return;
    _stopInFlight = true;
    _startGeneration += 1;
    if (!_setStatus(RealtimeStatus.ending)) {
      _stopInFlight = false;
      return;
    }
    try {
      final session = _session;
      await ignoreCleanupError(_audioCapture.stop);
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      await ignoreCleanupError(() async => _audioSubscription?.cancel());
      await _recordDeviceAsrDiagnosticEvent('controller.stop_requested');
      await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
      await _drainDeviceAsrStopEvents();
      await ignoreCleanupError(() async => _asrSubscription?.cancel());
      await _drainAsrTextSegments();
      await _flushPendingLocalPartialTranslation();
      await ignoreCleanupError(_stopSpeaking);
      _sessionTimeoutTimer?.cancel();
      _audioSubscription = null;
      _asrSubscription = null;
      _resumeAfterLifecyclePause = false;
      if (session != null) {
        await _repository.prepareFinalization(
          session.sessionId,
          _segments,
          billableSeconds: _activeTimeClock.billableSeconds,
        );
      }
      _setStatus(RealtimeStatus.ended);
      if (session != null) {
        try {
          await _repository.end(session.sessionId, _segments);
        } catch (error) {
          _message = displayRealtimeFinalizationWarning(error);
          _notify();
        }
      } else {
        await ignoreCleanupError(_repository.closeRealtime);
      }
      _session = null;
    } finally {
      _stopInFlight = false;
    }
  }
}
