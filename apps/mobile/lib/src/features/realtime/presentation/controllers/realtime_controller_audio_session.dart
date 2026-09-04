part of 'realtime_controller.dart';

extension RealtimeControllerAudioSession on RealtimeController {
  void _listenForAudioSessionEvents() {
    if (_audioSessionSubscription != null) return;
    _audioSessionSubscription = _audioSessionCoordinator.events.listen(
      _handleAudioSessionEvent,
      onError: (Object _) {},
    );
  }

  void _handleAudioSessionEvent(AudioSessionEvent event) {
    if (event.type == AudioSessionEventType.captureInvalidated) {
      if (_status == RealtimeStatus.active ||
          _status == RealtimeStatus.connecting) {
        _captureInvalidated = true;
        unawaited(_recoverCaptureAfterAudioChange(rebuildOnly: true));
      }
      return;
    }
    if (event.type == AudioSessionEventType.routeChanged &&
        event.route != null) {
      _speechCaptureGate.updateRoute(event.route!);
      return;
    }
    if (event.type != AudioSessionEventType.interruptionEnded ||
        !event.shouldResume) {
      return;
    }
    unawaited(_recoverCaptureAfterAudioChange());
  }

  Future<void> _recoverCaptureAfterAudioChange(
      {bool rebuildOnly = false}) async {
    if (_audioSessionRecoveryInFlight ||
        _status != RealtimeStatus.active ||
        _session == null ||
        _stopInFlight) {
      return;
    }
    _audioSessionRecoveryInFlight = true;
    _captureInvalidated = false;
    try {
      if (_usesDeviceAsr) {
        await _mobileAsrProvider?.stop();
        if (!rebuildOnly) await _audioSessionCoordinator.endCapture();
        await _drainDeviceAsrStopEvents();
        if (_status == RealtimeStatus.active && _session != null) {
          await _startMobileAsrProvider();
        }
      } else {
        await _audioCapture.stop();
        if (!rebuildOnly) await _audioSessionCoordinator.endCapture();
        await _audioSubscription?.cancel();
        _audioSubscription = null;
        if (_status == RealtimeStatus.active && _session != null) {
          await _startAudioCapture();
        }
      }
    } catch (error) {
      _fail(await _failureMessage(error));
    } finally {
      _audioSessionRecoveryInFlight = false;
      if (_captureInvalidated) {
        unawaited(_recoverCaptureAfterAudioChange(rebuildOnly: true));
      }
    }
  }

  Future<void> _resumeManagedAudioCapture() async {
    try {
      await _startAudioCapture();
    } catch (_) {
      await ignoreCleanupError(_audioCapture.stop);
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      rethrow;
    }
  }
}
