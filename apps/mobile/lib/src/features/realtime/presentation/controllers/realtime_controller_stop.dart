part of 'realtime_controller.dart';

extension RealtimeControllerStop on RealtimeController {
  Future<void> stop() {
    if (_stopFuture != null) return _stopFuture!;
    late final Future<void> pending;
    pending = _stopOnce().whenComplete(() {
      if (identical(_stopFuture, pending)) _stopFuture = null;
    });
    return _stopFuture = pending;
  }

  Future<void> _stopOnce() async {
    if (resourceOperationRunning) {
      await cancelLocalResourcePreparation();
      if (_status == RealtimeStatus.idle || isTerminalRealtimeStatus(_status)) {
        return;
      }
    }
    if (_stopInFlight || isTerminalRealtimeStatus(_status)) return;
    _stopInFlight = true;
    _resultSyncView.epoch++;
    _resultSyncView.busy = false;
    _repository.invalidateResultSync();
    _startGeneration += 1;
    if (!_setStatus(RealtimeStatus.ending)) {
      _stopInFlight = false;
      return;
    }
    try {
      final session = _session;
      // User stop must silence playback before waiting for ASR's bounded tail.
      await ignoreCleanupError(_stopSpeaking);
      if (session?.syncBinding != null && !_usesDeviceAsr) {
        _drainingPublicAudio = true;
        try {
          await _audioCapture.stop();
        } catch (error) {
          _fail(displayRealtimeErrorMessage(error));
          return;
        } finally {
          _drainingPublicAudio = false;
        }
      } else {
        await ignoreCleanupError(_audioCapture.stop);
      }
      if (_status == RealtimeStatus.failed) return;
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      await ignoreCleanupError(() async => _audioSubscription?.cancel());
      await _recordDeviceAsrDiagnosticEvent('controller.stop_requested');
      await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
      await _drainDeviceAsrStopEvents();
      await ignoreCleanupError(() async => _asrSubscription?.cancel());
      var tailComplete = true;
      if (_usesLocalCheckpoints) {
        tailComplete = await _drainLocalCheckpointTail();
      } else {
        await _drainAsrTextSegments();
        await _flushPendingLocalPartialTranslation();
      }
      await ignoreCleanupError(_stopSpeaking);
      _sessionTimeoutTimer?.cancel();
      _audioSubscription = null;
      _asrSubscription = null;
      _resumeAfterLifecyclePause = false;
      if (session != null && _usesLocalCheckpoints) {
        await _finishLocalCheckpoint(session, tailComplete: tailComplete);
        return;
      }
      if (session?.syncBinding != null) {
        await _finishPublicLifecycle(session!);
        return;
      }
      if (session != null) {
        await _repository.prepareFinalization(
          session.sessionId,
          _finalizationSegments,
          billableSeconds: _activeTimeClock.billableSeconds,
        );
      }
      _setStatus(RealtimeStatus.ended);
      if (session != null) {
        try {
          await _repository.end(session.sessionId, _finalizationSegments);
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
