part of 'realtime_controller.dart';

extension RealtimeControllerStop on RealtimeController {
  Future<void> stop() async {
    if (_stopInFlight || isTerminalRealtimeStatus(_status)) return;
    final wasStarting = _status == RealtimeStatus.connecting;
    _stopInFlight = true;
    _startGeneration += 1;
    if (!_setStatus(RealtimeStatus.ending)) {
      _stopInFlight = false;
      return;
    }
    try {
      final session = _session;
      if (_config.onDeviceOnly && wasStarting) await _cancelLocalTranslation();
      await ignoreCleanupError(_audioCapture.stop);
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      await ignoreCleanupError(() async => _audioSubscription?.cancel());
      await _recordDeviceAsrDiagnosticEvent('controller.stop_requested');
      await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
      await _drainDeviceAsrStopEvents();
      await ignoreCleanupError(() async => _asrSubscription?.cancel());
      final drained=await _drainAsrTextSegments();
      if (drained && _config.onDeviceOnly) {
        try {
          await _flushPendingLocalPartialTranslation().timeout(_localTranslationDrainTimeout);
        } on TimeoutException {
          _localWorkGeneration++;
          await _cancelLocalTranslation();
          _message='翻译未完成，已保留当前原文。';_notify();
        }
      } else if (drained) {
        await _flushPendingLocalPartialTranslation();
      } else {
        _localPartialFlush.cancel();
      }
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
      if (!_config.onDeviceOnly) _setStatus(RealtimeStatus.ended);
      if (session != null) {
        final snapshot=List<SubtitleSegment>.unmodifiable(_segments);
        try {
          await _repository.end(session.sessionId, snapshot);
          if (_config.onDeviceOnly) _setStatus(RealtimeStatus.ended);
        } catch (error) {
          if (_config.onDeviceOnly) {
            _pendingLocalSave=session;_pendingLocalSegments=snapshot;
            _setStatus(RealtimeStatus.failed);
            _message='本机记录未保存，请保留页面并重试保存。';
          } else {
            _message = displayRealtimeFinalizationWarning(error);
          }
          _notify();
        }
      } else {
        await ignoreCleanupError(_repository.closeRealtime);
        if (_config.onDeviceOnly) _setStatus(RealtimeStatus.ended);
      }
      _session = null;
    } finally {
      _stopInFlight = false;
    }
  }
}
