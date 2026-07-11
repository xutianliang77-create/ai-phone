part of 'realtime_controller.dart';

extension RealtimeControllerSpeech on RealtimeController {
  void _speakTranslationIfNeeded(String text, String targetLanguage) {
    final speaker = _speechOutputProvider;
    final speechText = text.trim();
    if (!_autoSpeakTranslation || speaker == null || speechText.isEmpty) {
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
    _openSpeechCaptureGate();
    try {
      await speaker.speak(text: text, language: language).timeout(
            _speechTimeoutFor(text),
          );
    } on TimeoutException {
      await ignoreCleanupError(speaker.stop);
    } on Object {
      // A single platform TTS failure must not block later translations.
    } finally {
      if (generation == _speechGeneration) _coolDownSpeechCaptureGate();
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
    _clearSpeechCaptureGate();
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
    _openSpeechCaptureGate();
    try {
      await player.play(
        data: data,
        sampleRate: sampleRate,
      ).timeout(const Duration(seconds: 30));
    } on TimeoutException {
      await ignoreCleanupError(player.stop);
    } on Object {
      // A single service TTS playback failure must not block later captions.
    } finally {
      if (generation == _speechGeneration) _coolDownSpeechCaptureGate();
    }
  }

  void _openSpeechCaptureGate() {
    _speechCaptureGateUntil = DateTime.now().add(
      RealtimeController._speechEchoCooldown,
    );
  }

  void _coolDownSpeechCaptureGate() {
    _speechCaptureGateUntil = DateTime.now().add(
      RealtimeController._speechEchoCooldown,
    );
  }

  void _clearSpeechCaptureGate() {
    _speechCaptureGateUntil = DateTime.fromMillisecondsSinceEpoch(0);
  }
}
