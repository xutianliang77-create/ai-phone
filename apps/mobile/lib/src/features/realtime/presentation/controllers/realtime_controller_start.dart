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
    final completion = Completer<void>();
    final completionFuture = completion.future;
    _startCompletion = completionFuture;
    _setStatus(RealtimeStatus.connecting);
    try {
      await _startSession(generation);
    } catch (error) {
      if (_isCurrentStart(generation)) {
        _fail(await _failureMessage(error));
      }
    } finally {
      completion.complete();
      if (identical(_startCompletion, completionFuture)) {
        _startCompletion = null;
      }
    }
  }

  Future<void> _startSession(int generation) async {
    _session = null;
    _remainingSeconds = null;
    _lowBalance = false;
    _gatewayDiagnostic = null;
    _statusBeforeReconnect = null;
    _segments.clear();
    _drafts.clear();
    _deviceAsrRecovery.reset();
    if (_usesDeviceAsr) {
      await _prepareDeviceAsr();
      if (!_isCurrentStart(generation)) return;
    }
    await _eventSubscription?.cancel();
    if (!_isCurrentStart(generation)) return;
    _eventSubscription = _repository.events.listen(
      handleGatewayEvent,
      onError: (Object error) => _handleEventStreamError(generation, error),
    );
    _session = await _repository.startSession();
    if (!_isCurrentStart(generation)) return;
    _startSessionTimeout(_session!);
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
