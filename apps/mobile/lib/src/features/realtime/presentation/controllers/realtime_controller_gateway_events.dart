part of 'realtime_controller.dart';

extension RealtimeControllerGatewayEvents on RealtimeController {
  void handleGatewayEvent(GatewayRealtimeEvent event) {
    if (isTerminalRealtimeStatus(_status) && !_stopInFlight) return;
    final activeSessionId = _session?.sessionId;
    if (activeSessionId != null &&
        event.sessionId != null &&
        event.sessionId != activeSessionId) {
      return;
    }
    if (event.type == 'error') {
      final message = _gatewayErrorMessage(event);
      _gatewayDiagnostic = RealtimeGatewayDiagnostic.fromEvent(
        event,
        displayMessage: message,
      );
      _fail(message);
      return;
    }
    if (event.type == 'translation.failed' && event.segmentId != null) {
      _gatewayDiagnostic = RealtimeGatewayDiagnostic.fromEvent(
        event,
        displayMessage: _gatewayErrorMessage(event),
      );
      _upsertSegment(
        event.segmentId!,
        turnId: event.turnId,
        revision: event.revision,
        translatedText: event.message ?? 'Translation unavailable',
        targetLanguage: event.language,
        stage: event.stage ?? 'translation',
        provider: event.provider,
        model: event.model,
        latencyMs: event.latencyMs,
        languageProfile: event.languageProfile,
      );
      _message = event.message;
      _notify();
      return;
    }
    if (event.type == 'connection.reconnecting') {
      if (_status == RealtimeStatus.active ||
          _status == RealtimeStatus.paused) {
        _statusBeforeReconnect = _status;
      }
      _setStatus(RealtimeStatus.connecting);
      _message = event.message;
      _notify();
      return;
    }
    if (event.type == 'connection.reconnected') {
      _gatewayDiagnostic = null;
      final previous = _statusBeforeReconnect;
      _statusBeforeReconnect = null;
      if (previous == RealtimeStatus.paused) {
        unawaited(_restorePauseAfterReconnect());
      } else {
        _setStatus(RealtimeStatus.active);
      }
      _message = event.message;
      _notify();
      return;
    }
    if (event.type == 'connection.closed') {
      _fail(displayRealtimeErrorMessage(
        event.message ?? 'Realtime connection lost',
      ));
      return;
    }
    if (event.type == 'usage.tick') {
      _remainingSeconds = event.remainingSeconds;
      _lowBalance = event.lowBalance == true;
      _notify();
      return;
    }
    if (event.type == 'session.ended') {
      if (_stopInFlight) return;
      _handleRemoteSessionEnded(event);
      return;
    }
    if (event.type == 'session.paused') {
      _setStatus(RealtimeStatus.paused);
      return;
    }
    if (event.type == 'session.resumed') {
      _setStatus(RealtimeStatus.active);
      return;
    }
    if (event.type == 'transcript.partial' && event.segmentId != null) {
      final text = _cleanRealtimeText(event.text);
      if (text != null) {
        _upsertSegment(
          event.segmentId!,
          appendSourceText: text,
          sourceLanguage: event.language,
          confidence: event.confidence,
          stage: 'asr',
          speaker: event.speaker,
          timing: event.timing,
          vadContext: event.vadContext,
          languageProfile: event.languageProfile,
        );
      }
    }
    if (event.type == 'transcript.final' && event.segmentId != null) {
      final text = _cleanRealtimeText(event.text);
      if (text == null) {
        _removeSegment(event.segmentId!);
      } else {
        _upsertSegment(
          event.segmentId!,
          turnId: event.turnId,
          revision: event.revision,
          sourceText: text,
          rawText: event.rawText,
          optimizedText: event.optimizedText,
          sourceLanguage: event.language,
          confidence: event.confidence,
          stage: 'asr',
          refinement: event.refinement,
          speaker: event.speaker,
          timing: event.timing,
          vadContext: event.vadContext,
          languageProfile: event.languageProfile,
        );
      }
    }
    if (event.type == 'translation.delta' && event.segmentId != null) {
      final text = _cleanRealtimeText(event.text);
      if (text != null) {
        _upsertSegment(event.segmentId!, appendTranslatedText: text);
      }
    }
    if (event.type == 'translation.final' && event.segmentId != null) {
      final text = _cleanRealtimeText(event.text);
      if (text != null) {
        _gatewayDiagnostic = null;
        _upsertSegment(
          event.segmentId!,
          turnId: event.turnId,
          revision: event.revision,
          translatedText: text,
          targetLanguage: event.language,
          stage: 'translation',
          provider: event.provider,
          model: event.model,
          latencyMs: event.latencyMs,
          speaker: event.speaker,
          timing: event.timing,
          vadContext: event.vadContext,
          languageProfile: event.languageProfile,
        );
        if (_usesDeviceAsr) {
          _speakTranslationIfNeeded(
              text, event.language ?? _config.targetLanguage);
        }
      }
    }
    if (event.type == 'speaker.updated' && event.segmentId != null) {
      _upsertSegment(
        event.segmentId!,
        turnId: event.turnId,
        revision: event.revision,
        speaker: event.speaker,
        timing: event.timing,
      );
    }
    if (event.type == 'audio.output') {
      _playAudioOutputIfNeeded(event);
      return;
    }
  }

  String _gatewayErrorMessage(GatewayRealtimeEvent event) {
    final message = displayRealtimeErrorMessage(
      event.message ?? 'Realtime provider error',
    );
    final stage = _gatewayErrorStageLabel(event.stage);
    if (stage == null) return message;
    final retry = event.retryable == true ? '，可重试' : '';
    return '$stage：$message$retry';
  }

  String? _gatewayErrorStageLabel(String? stage) {
    switch (stage) {
      case 'connection':
        return '实时连接';
      case 'session':
        return '会话';
      case 'provider':
        return '在线模型';
      case 'asr':
        return 'ASR 识别';
      case 'translation':
        return '翻译';
      case 'tts':
        return 'TTS 朗读';
      default:
        return null;
    }
  }

  void _handleRemoteSessionEnded(GatewayRealtimeEvent event) {
    _message = _remoteEndMessage(event);
    _remainingSeconds = event.remainingSeconds;
    _lowBalance = false;
    _setStatus(RealtimeStatus.ended);
    _session = null;
    _resumeAfterLifecyclePause = false;
    _statusBeforeReconnect = null;
    _localPartialFlush.cancel();
    _deviceAsrRecovery.reset();
    unawaited(_stopSpeaking());
    unawaited(_cleanupAfterRemoteEnd());
    _notify();
  }

  Future<void> _restorePauseAfterReconnect() async {
    final session = _session;
    if (session == null) return;
    if (!await _repository.pauseAndWait(session.sessionId)) {
      _fail('Realtime connection lost');
    }
  }

  Future<void> _cleanupAfterRemoteEnd() async {
    _sessionTimeoutTimer?.cancel();
    await ignoreCleanupError(_audioCapture.stop);
    await ignoreCleanupError(_audioSessionCoordinator.endCapture);
    await ignoreCleanupError(() async => _audioSubscription?.cancel());
    await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
    await ignoreCleanupError(_stopSpeaking);
    await ignoreCleanupError(() async => _asrSubscription?.cancel());
    _audioSubscription = null;
    _asrSubscription = null;
    await ignoreCleanupError(_repository.closeRealtime);
  }

  String _remoteEndMessage(GatewayRealtimeEvent event) {
    switch (event.reason) {
      case 'quota_exhausted':
        return '剩余分钟已用完，已自动结束同传';
      case 'time_limit':
        return '本次同传已达到最长时长';
      default:
        return '同传已结束';
    }
  }
}
