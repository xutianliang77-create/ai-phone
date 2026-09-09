part of 'realtime_controller.dart';

extension RealtimeControllerLifecycle on RealtimeController {
  Future<void> handleLifecycleState(AppLifecycleState state) async {
    if (state == AppLifecycleState.detached) {
      _resumeAfterLifecyclePause = false;
      await stop();
      return;
    }
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
