part of 'realtime_controller.dart';

extension RealtimeControllerStart on RealtimeController {
  Future<void> start() async {
    _listenForAudioSessionEvents();
    if (_stopInFlight) return;
    if (_status == RealtimeStatus.paused) {
      await _resumeOrFail();
      return;
    }
    if (_status == RealtimeStatus.connecting ||
        _status == RealtimeStatus.active ||
        _status == RealtimeStatus.ending) {
      return;
    }
    if (_status == RealtimeStatus.failed) {
      await _failureCleanup?.catchError((Object _) {});
      if (_status != RealtimeStatus.failed) return;
    }

    final generation = ++_startGeneration;
    _setStatus(RealtimeStatus.connecting);
    try {
      await _startSession(generation);
    } catch (error) {
      if (_isCurrentStart(generation)) {
        _fail(await _failureMessage(error));
      }
    }
  }

  Future<void> _startSession(int generation) async {
    _activeTimeClock.reset();
    _session = null;
    _remainingSeconds = null;
    _lowBalance = false;
    _gatewayDiagnostic = null;
    _statusBeforeReconnect = null;
    _segments.clear();
    _drafts.clear();
    _speechEchoSegmentIds.clear();
    _asrTextChain = Future<void>.value();
    _deviceAsrRecovery.reset();
    if (_usesDeviceAsr) {
      await _prepareDeviceAsr();
      if (!_isCurrentStart(generation)) return;
      await _prepareOnDeviceTranslation();
      if (!_isCurrentStart(generation)) return;
    }
    await _eventSubscription?.cancel();
    if (!_isCurrentStart(generation)) return;
    _eventSubscription = _repository.events.listen(
      handleGatewayEvent,
      onError: (Object error) => _handleEventStreamError(generation, error),
    );
    final session = await _repository.startSession();
    if (!_isCurrentStart(generation)) {
      unawaited(_repository
          .end(session.sessionId, _segments)
          .catchError((Object _) {}));
      return;
    }
    _session = session;
    _startSessionTimeout(session);
    if (_usesDeviceAsr) {
      await _startDeviceAsr();
    } else {
      await _startAudioCapture();
    }
    if (_isCurrentStart(generation)) {
      _setStatus(RealtimeStatus.active);
    }
  }

  bool _isCurrentStart(int generation) =>
      generation == _startGeneration &&
      _status == RealtimeStatus.connecting &&
      !_stopInFlight;

  void _handleEventStreamError(int generation, Object error) {
    final canFail = _isCurrentStart(generation) ||
        _status == RealtimeStatus.active ||
        _status == RealtimeStatus.paused;
    if (canFail) _fail(displayRealtimeErrorMessage(error));
  }
}
