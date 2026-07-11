part of 'realtime_controller.dart';

const _deviceAsrRecoveryWindow = Duration(seconds: 12);

extension RealtimeControllerDeviceAsrRecovery on RealtimeController {
  Future<void> _startDeviceAsr() async {
    final provider = _mobileAsrProvider;
    if (provider == null) {
      throw UnsupportedError('Device ASR provider is not configured');
    }
    await provider.requestPermission();
    await _asrSubscription?.cancel();
    _asrSubscription = provider.segments.listen(
      _sendTextSegment,
      onError: _handleDeviceAsrStreamError,
    );
    await _startMobileAsrProvider();
  }

  Future<void> _startMobileAsrProvider() async {
    try {
      await _mobileAsrProvider?.start(createDeviceAsrConfig(_config));
      _deviceAsrRecovery.markStarted();
    } catch (error) {
      if (!_shouldRetryDeviceAsrStartup()) rethrow;
      await _retryDeviceAsrStartup();
    }
  }

  void _handleDeviceAsrStreamError(Object error) {
    unawaited(_recoverOrFailDeviceAsr(error));
  }

  void _handleAsrTextSegmentError(Object error) {
    unawaited(_failWithRealtimeError(error));
  }

  void _sendTextSegment(AsrTextSegment segment) {
    final session = _session;
    if (session == null ||
        (_status != RealtimeStatus.active && !_stopInFlight)) {
      return;
    }
    if (_isSpeechCaptureGateActive) return;
    unawaited(
      _handleAsrTextSegment(session.sessionId, segment).catchError(
        _handleAsrTextSegmentError,
      ),
    );
  }

  Future<void> _recoverOrFailDeviceAsr(Object error) async {
    if (!_shouldRecoverDeviceAsr()) {
      await _failWithRealtimeError(error);
      return;
    }
    _deviceAsrRecovery.beginRestart();
    _message = 'Restarting device ASR';
    _notify();
    try {
      await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
      await _drainDeviceAsrStopEvents();
      await _startMobileAsrProvider();
      if (_status == RealtimeStatus.active) {
        _message = null;
        _notify();
      }
    } catch (restartError) {
      await _failWithRealtimeError(restartError);
    } finally {
      _deviceAsrRecovery.finishRestart();
    }
  }

  Future<void> _failWithRealtimeError(Object error) async {
    _fail(await _failureMessage(error));
  }

  Future<void> _drainDeviceAsrStopEvents() async {
    if (_usesDeviceAsr) {
      await Future<void>.delayed(RealtimeController._deviceAsrStopDrain);
    }
  }

  bool _shouldRecoverDeviceAsr() {
    return _usesDeviceAsr &&
        _status == RealtimeStatus.active &&
        _session != null &&
        !_stopInFlight &&
        _deviceAsrRecovery.canRestart &&
        _deviceAsrRecovery.startedWithin(_deviceAsrRecoveryWindow);
  }

  bool _shouldRetryDeviceAsrStartup() {
    return _usesDeviceAsr &&
        _status == RealtimeStatus.connecting &&
        _session != null &&
        !_stopInFlight &&
        _deviceAsrRecovery.canRetryStartup;
  }

  Future<void> _retryDeviceAsrStartup() async {
    _deviceAsrRecovery.beginStartupRetry();
    _message = 'Restarting device ASR';
    _notify();
    await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
    await _drainDeviceAsrStopEvents();
    await _mobileAsrProvider?.start(createDeviceAsrConfig(_config));
    _deviceAsrRecovery.markStarted();
    if (_status == RealtimeStatus.connecting) {
      _message = null;
      _notify();
    }
  }
}

class _DeviceAsrRecovery {
  DateTime? _startedAt;
  bool _restartUsed = false;
  bool _restartInFlight = false;
  bool _startupRetryUsed = false;

  bool get canRestart => !_restartUsed && !_restartInFlight;
  bool get canRetryStartup => !_startupRetryUsed;

  void reset() {
    _startedAt = null;
    _restartUsed = false;
    _restartInFlight = false;
    _startupRetryUsed = false;
  }

  void markStarted() {
    _startedAt = DateTime.now();
  }

  bool startedWithin(Duration window) {
    final startedAt = _startedAt;
    return startedAt != null && DateTime.now().difference(startedAt) <= window;
  }

  void beginRestart() {
    _restartUsed = true;
    _restartInFlight = true;
  }

  void finishRestart() {
    _restartInFlight = false;
  }

  void beginStartupRetry() {
    _startupRetryUsed = true;
  }
}
