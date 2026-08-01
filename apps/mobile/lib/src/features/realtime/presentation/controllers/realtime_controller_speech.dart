part of 'realtime_controller.dart';

extension RealtimeControllerSpeech on RealtimeController {
  void _setSpeechOutputActive(bool active) {
    if (_speechOutputActive == active) return;
    _speechOutputActive = active;
    _notify();
  }

  void _speakTranslationIfNeeded(String text, String targetLanguage) {
    final speaker = _speechOutputProvider;
    final speechText = text.trim();
    if (_status != RealtimeStatus.active ||
        !_autoSpeakTranslation ||
        speaker == null ||
        speechText.isEmpty) {
      return;
    }
    final normalizedText =
        normalizeSpeechOutputText(speechText, targetLanguage);
    final generation = _speechGeneration;
    _speechChain = _speechChain.catchError((Object _) {}).then((_) {
      if (generation != _speechGeneration) return null;
      return _speakWithTimeout(speaker, normalizedText, targetLanguage);
    }).then<void>((_) {});
  }

  Future<void> _speakWithTimeout(
    SpeechOutputProvider speaker,
    String text,
    String language,
  ) async {
    final generation = _speechGeneration;
    await _recordDeviceAsrDiagnosticEvent(
      'tts.begin',
      payload: <String, Object?>{
        'text': text,
        'language': language,
        'route': 'system_speech',
        'requiresAcousticEchoSuppression':
            _speechCaptureGate.requiresAcousticEchoSuppression,
      },
    );
    _speechCaptureGate.beginPlayback(text: text, language: language);
    _setSpeechOutputActive(true);
    try {
      await speaker.speak(text: text, language: language).timeout(
            _speechTimeoutFor(text),
          );
    } on TimeoutException {
      await ignoreCleanupError(speaker.stop);
    } on Object {
      // A single platform TTS failure must not block later translations.
    } finally {
      if (generation == _speechGeneration) {
        _speechCaptureGate.endPlayback();
        _setSpeechOutputActive(false);
        await _recordDeviceAsrDiagnosticEvent(
          'tts.end',
          payload: <String, Object?>{
            'text': text,
            'language': language,
            'route': 'system_speech',
            'requiresAcousticEchoSuppression':
                _speechCaptureGate.requiresAcousticEchoSuppression,
          },
        );
      }
    }
  }

  Duration _speechTimeoutFor(String text) {
    final configured = _speechOutputTimeout;
    if (configured != null) return configured;
    final estimatedMs = 5000 + text.runes.length * 220;
    return Duration(milliseconds: estimatedMs.clamp(8000, 30000).toInt());
  }

  Future<void> _stopSpeaking() async {
    _speechGeneration += 1;
    await _recordDeviceAsrDiagnosticEvent(
      'tts.stop_requested',
      payload: <String, Object?>{
        'requiresAcousticEchoSuppression':
            _speechCaptureGate.requiresAcousticEchoSuppression,
      },
    );
    _speechCaptureGate.reset();
    _setSpeechOutputActive(false);
    await _speechOutputProvider?.stop();
    await _pcmAudioOutputPlayer?.stop();
  }

  void _playAudioOutputIfNeeded(GatewayRealtimeEvent event) {
    final player = _pcmAudioOutputPlayer;
    if (!_autoSpeakTranslation ||
        player == null ||
        event.format != 'pcm16' ||
        event.data == null ||
        event.sampleRate == null) {
      return;
    }
    final data = event.data!;
    final sampleRate = event.sampleRate!;
    final generation = _speechGeneration;
    _speechChain = _speechChain.catchError((Object _) {}).then((_) {
      if (generation != _speechGeneration) return null;
      return _playPcmWithTimeout(player, data, sampleRate);
    }).then<void>((_) {});
  }

  Future<void> _playPcmWithTimeout(
    PcmAudioOutputPlayer player,
    String data,
    int sampleRate,
  ) async {
    final generation = _speechGeneration;
    await _recordDeviceAsrDiagnosticEvent(
      'tts.begin',
      payload: <String, Object?>{
        'format': 'pcm16',
        'sampleRate': sampleRate,
        'base64Length': data.length,
        'route': 'pcm_player',
        'requiresAcousticEchoSuppression':
            _speechCaptureGate.requiresAcousticEchoSuppression,
      },
    );
    _speechCaptureGate.beginPlayback();
    _setSpeechOutputActive(true);
    try {
      await player
          .play(
            data: data,
            sampleRate: sampleRate,
          )
          .timeout(const Duration(seconds: 30));
    } on TimeoutException {
      await ignoreCleanupError(player.stop);
    } on Object {
      // A single service TTS playback failure must not block later captions.
    } finally {
      if (generation == _speechGeneration) {
        _speechCaptureGate.endPlayback();
        _setSpeechOutputActive(false);
        await _recordDeviceAsrDiagnosticEvent(
          'tts.end',
          payload: <String, Object?>{
            'format': 'pcm16',
            'sampleRate': sampleRate,
            'route': 'pcm_player',
            'requiresAcousticEchoSuppression':
                _speechCaptureGate.requiresAcousticEchoSuppression,
          },
        );
      }
    }
  }
}
