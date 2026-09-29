part of 'realtime_controller.dart';

extension _RealtimeControllerAudioInput on RealtimeController {
  Future<void> _startAudioCapture() async {
    if (_endpointStartGeneration != _startGeneration) {
      _endpointStartGeneration = _startGeneration;
      _resetPublicEndpoints();
    }
    await _audioCapture.requestPermission();
    await _audioSubscription?.cancel();
    // Retain a spoken session's duplex graph across mute/route recovery. A new
    // silent session resets this flag and keeps the previously accepted input.
    if (_session?.syncBinding != null && _autoSpeakTranslation) {
      _publicPlaybackReference = true;
    }
    final publicPlayback = _session?.syncBinding != null && _publicPlaybackReference;
    final voiceProcessing = _config.realtimeMode == 'conversation' ||
        (publicPlayback && defaultTargetPlatform == TargetPlatform.iOS);
    await _audioSessionCoordinator.beginCapture(
      voiceProcessing: voiceProcessing,
      publicPlaybackReference: publicPlayback && defaultTargetPlatform == TargetPlatform.iOS,
    );
    try {
      _audioSubscription =
          _audioCapture.frames.listen(_sendAudioFrame, onError: (Object error) {
        if (_status != RealtimeStatus.ending &&
            !isTerminalRealtimeStatus(_status)) {
          _fail(displayRealtimeErrorMessage(error));
        }
      });
      await _audioCapture.start(AudioCaptureConfig(
        sampleRate: _session?.syncBinding?.captureSampleRate ?? 24000,
        echoCancel: voiceProcessing,
        noiseSuppress: voiceProcessing,
        managePlatformAudioSession:
            !_audioSessionCoordinator.managesPlatformAudioSession,
        publicEndpointing: _session?.syncBinding != null,
        publicPlaybackReference: publicPlayback,
        endpointOptions: {
          'vadProvider': _config.deviceAsrVadProvider,
          'vadThreshold': _config.deviceAsrVadThreshold,
          'vadNegativeThreshold': _config.deviceAsrVadNegativeThreshold,
          'endpointMinSpeechMs': _config.deviceAsrEndpointMinSpeechMs,
          'endpointSilenceMs': _config.deviceAsrEndpointSilenceMs,
          if (_session?.syncBinding != null &&
              const bool.fromEnvironment('ENABLE_ONLINE_EVIDENCE_TRACE')) ...{
            'diagnosticCaptureEnabled': true,
            'diagnosticSessionId': _session!.sessionId,
          },
        },
      ));
    } catch (_) {
      await _audioSubscription?.cancel();
      _audioSubscription = null;
      await ignoreCleanupError(_audioSessionCoordinator.endCapture);
      rethrow;
    }
  }

  void _sendAudioFrame(AudioFrame frame) {
    final session = _session;
    final active = _status == RealtimeStatus.active;
    final reconnecting = _status == RealtimeStatus.connecting &&
        _statusBeforeReconnect == RealtimeStatus.active;
    if (session == null ||
        (!active &&
            !reconnecting &&
            !(_drainingPublicAudio && _status == RealtimeStatus.ending))) {
      return;
    }
    // Public online sessions keep the physical PCM stream continuous while
    // TTS plays. The unchanged native VAD confirms speech-start separately
    // from its endpoint; neither a raw PCM packet nor a tail boundary is an interruption.
    if (_speechCaptureGate.blocksCapture && session.syncBinding == null) {
      return;
    }
    final sent = _repository.sendAudio(session.sessionId, frame);
    if (session.syncBinding == null) return;
    if (!sent) {
      _fail('公有音频发送失败，已停止，未自动重放');
      return;
    }
    _publicTurnSamples += frame.bytes.length ~/ 2;
    if (_status == RealtimeStatus.ending) return;
    if (frame.startsSegment && (_speechCaptureGate.isPlaying ||
        _publicAudioRevisionBySegment.isNotEmpty)) unawaited(_stopSpeaking());
    if (frame.endsSegment ||
        _publicTurnSamples >= frame.sampleRate * 28 ||
        _publicEndpointRequested) {
      _requestPublicEndpoint(session, frame.sampleRate);
    }
  }

  void _resetPublicEndpoints() {
    _endpointEpoch++;
    _pendingEndpoints = 0;
    _publicTurnSamples = 0;
    _publicEndpointRequested = false;
  }

  void _requestPublicEndpoint(RealtimeSession session, int sampleRate) {
    if (_publicTurnSamples == 0) return;
    _publicEndpointRequested = true;
    if (_publicTurnSamples < sampleRate ~/ 10) return;
    if (_pendingEndpoints >= 4) {
      _fail('端点确认队列已满，已停止');
      return;
    }
    final epoch = _endpointEpoch;
    _publicTurnSamples = 0;
    _publicEndpointRequested = false;
    _pendingEndpoints++;
    unawaited(
        _repository.commitAudioBoundary(session.sessionId).then((confirmed) {
      if (!confirmed &&
          epoch == _endpointEpoch &&
          identical(_session, session) &&
          _status == RealtimeStatus.active) {
        _fail('语音端点未确认，已停止，未自动重试');
      }
    }).catchError((Object error) {
      if (epoch == _endpointEpoch &&
          identical(_session, session) &&
          _status == RealtimeStatus.active) {
        _fail(displayRealtimeErrorMessage(error));
      }
    }).whenComplete(() {
      if (epoch == _endpointEpoch && _pendingEndpoints > 0) _pendingEndpoints--;
    }));
  }

}
