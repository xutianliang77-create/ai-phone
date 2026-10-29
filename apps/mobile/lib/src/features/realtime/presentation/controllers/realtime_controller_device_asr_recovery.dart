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
    await _audioSessionCoordinator.beginCapture();
    try {
      await _mobileAsrProvider?.start(createDeviceAsrConfig(
        _config,
        diagnosticSessionId: _session?.sessionId,
      ));
      _deviceAsrRecovery.markStarted();
      await _recordDeviceAsrDiagnosticEvent(
        'controller.asr_started',
        payload: <String, Object?>{
          'sessionId': _session?.sessionId,
          'language': _config.deviceAsrLanguage,
        },
      );
    } catch (error) {
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      if (!_shouldRetryDeviceAsrStartup()) rethrow;
      await _retryDeviceAsrStartup();
    }
  }

  void _handleDeviceAsrStreamError(Object error) {
    unawaited(_recoverOrFailDeviceAsr(error));
  }

  void _sendTextSegment(AsrTextSegment segment) {
    final session = _session;
    if (session == null ||
        (_status != RealtimeStatus.active && !_stopInFlight)) {
      return;
    }
    if (segment.isRetraction) {
      _localPartialFlush.clearIfSameId(segment.id); _removeSegment(segment.id);
      _checkpointLocalSession(session.sessionId); return;
    }
    final isPlaybackEcho = _speechCaptureGate.shouldDropDeviceAsr(
      text: segment.text,
      language: segment.language,
    );
    if (isPlaybackEcho) _speechEchoSegmentIds.add(segment.id);
    final segmentWasMarkedAsEcho = _speechEchoSegmentIds.contains(segment.id);
    if (segment.isFinal) _speechEchoSegmentIds.remove(segment.id);
    unawaited(_recordDeviceAsrDiagnosticEvent(
      'capture_gate.decision',
      payload: <String, Object?>{
        'segmentId': segment.id,
        'isFinal': segment.isFinal,
        'playbackActive': _speechCaptureGate.playbackActive,
        'droppedAsEcho': segmentWasMarkedAsEcho,
      },
    ));
    if (segmentWasMarkedAsEcho) return;
    // Preserve a final recognition before waiting behind an earlier translation.
    // A failed or stalled translator must not discard already-recognized text.
    if (_config.onDeviceOnly && segment.isFinal) {
      _upsertSegment(segment.id, sourceText: segment.text,
          sourceLanguage: segment.language, confidence: segment.confidence,
          stage: 'asr');
      _checkpointLocalSession(session.sessionId);
    }
    if (_speechCaptureGate.playbackActive) {
      unawaited(_stopSpeaking());
    }
    final sessionId = session.sessionId;
    final localGeneration = _localWorkGeneration;
    final queued = _asrTextChain.then((_) async {
      final currentSession = _session;
      if (currentSession?.sessionId != sessionId ||
          (_config.onDeviceOnly && localGeneration != _localWorkGeneration) ||
          (_status != RealtimeStatus.active && !_stopInFlight)) {
        return;
      }
      await _handleAsrTextSegment(sessionId, segment);
    });
    _asrTextChain = queued.catchError((Object error) async {
      if (_config.onDeviceOnly &&
          (_session?.sessionId != sessionId ||
           localGeneration != _localWorkGeneration)) { return; }
      await _failWithRealtimeError(error);
    });
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

  Future<bool> _drainAsrTextSegments() async {
    final work=_asrTextChain.catchError((Object _) {});
    if (!_config.onDeviceOnly) { await work; return true; }
    try {
      await work.timeout(_localTranslationDrainTimeout);
      return true;
    } on TimeoutException {
      _localWorkGeneration++;
      _asrTextChain=Future<void>.value();
      await _cancelLocalTranslation();
      _message='翻译未完成，已保留当前原文。';_notify();
      return false;
    }
  }

  Future<void> _recordDeviceAsrDiagnosticEvent(
    String type, {
    Map<String, Object?> payload = const <String, Object?>{},
  }) async {
    final isNativePlaybackControl = type.startsWith('tts.');
    if (!_config.deviceAsrDiagnosticCaptureEnabled &&
        !isNativePlaybackControl) {
      return;
    }
    final provider = _mobileAsrProvider;
    if (provider is! MobileAsrDiagnosticTimeline) return;
    final timeline = provider as MobileAsrDiagnosticTimeline;
    await ignoreCleanupError(() {
      return timeline.recordDiagnosticEvent(type, payload: payload);
    });
  }

  bool _shouldRecoverDeviceAsr() {
    return _usesDeviceAsr &&
        !(_config.onDeviceOnly && _config.sourceLanguage == 'auto') &&
        _status == RealtimeStatus.active &&
        _session != null &&
        !_stopInFlight &&
        !_audioSessionRecoveryInFlight &&
        _deviceAsrRecovery.canRestart &&
        _deviceAsrRecovery.startedWithin(_deviceAsrRecoveryWindow);
  }

  bool _shouldRetryDeviceAsrStartup() {
    return _usesDeviceAsr &&
        !(_config.onDeviceOnly && _config.sourceLanguage == 'auto') &&
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
    await ignoreCleanupError(_audioSessionCoordinator.endCapture);
    await _drainDeviceAsrStopEvents();
    await _startMobileAsrProvider();
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
