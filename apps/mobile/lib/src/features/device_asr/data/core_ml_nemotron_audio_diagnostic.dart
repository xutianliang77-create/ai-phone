class CoreMlNemotronAudioDiagnostic {
  const CoreMlNemotronAudioDiagnostic({
    required this.status,
    required this.audio,
    this.issue,
  });

  final String status;
  final String? issue;
  final Map<String, Object?> audio;

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'status': status,
      'issue': issue,
      'audio': audio,
    };
  }
}

CoreMlNemotronAudioDiagnostic? coreMlNemotronAudioDiagnostic(
  Map<String, Object?> details,
) {
  final audio = coreMlNemotronAudioDetails(details);
  if (audio.isEmpty) return null;
  if (_hasText(audio['sessionError'])) {
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'audio_session_error',
      audio: audio,
    );
  }
  if (_hasText(audio['voiceProcessingError']) ||
      (audio['voiceProcessingAttempted'] == true &&
          audio['lastVoiceProcessingEnabled'] != true)) {
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'voice_processing_error',
      audio: audio,
    );
  }
  if (_hasText(audio['processingError'])) {
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'asr_processing_error',
      audio: audio,
    );
  }
  if (audio['vadActiveProvider'] == 'rms_fallback') {
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'vad_fallback',
      audio: audio,
    );
  }
  if (audio.containsKey('inputBuffers') &&
      _intValue(audio['inputBuffers']) <= 0) {
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'no_microphone_input',
      audio: audio,
    );
  }
  if (audio.containsKey('convertedSamples') &&
      _intValue(audio['inputBuffers']) > 0 &&
      _intValue(audio['convertedSamples']) <= 0) {
    if (_intValue(audio['conversionFailures']) > 0 ||
        _intValue(audio['floatExtractionFailures']) > 0) {
      return CoreMlNemotronAudioDiagnostic(
        status: 'warning',
        issue: 'audio_conversion_failed',
        audio: audio,
      );
    }
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'no_converted_samples',
      audio: audio,
    );
  }
  if (audio.containsKey('emittedChunks') &&
      _intValue(audio['convertedSamples']) > 0 &&
      _intValue(audio['emittedChunks']) <= 0) {
    return CoreMlNemotronAudioDiagnostic(
      status: 'warning',
      issue: 'no_asr_chunks',
      audio: audio,
    );
  }
  return CoreMlNemotronAudioDiagnostic(status: 'ok', audio: audio);
}

Map<String, Object?> coreMlNemotronAudioDetails(
  Map<String, Object?> details,
) {
  final fluidAudio = details['fluidAudio'];
  if (fluidAudio is Map) {
    final audio = fluidAudio['audio'] is Map
        ? Map<String, Object?>.from(fluidAudio['audio'] as Map)
        : <String, Object?>{};
    final processingError = fluidAudio['processingError'];
    if (_hasText(processingError)) {
      audio['processingError'] = processingError;
    }
    final vad = fluidAudio['vad'];
    if (vad is Map) {
      audio['vadConfiguredProvider'] = vad['configuredProvider'];
      audio['vadActiveProvider'] = vad['activeProvider'];
      audio['vadFallbackReason'] = vad['fallbackReason'];
      audio['vadFallbackCount'] = vad['fallbackCount'];
      audio['vadLastProbability'] = vad['lastProbability'];
      audio['vadPreRollSamples'] = vad['preRollSamplesLimit'];
    }
    if (audio.isNotEmpty) return audio;
  }
  final audio = details['audio'];
  return audio is Map ? Map<String, Object?>.from(audio) : const {};
}

int _intValue(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return 0;
}

bool _hasText(Object? value) {
  return value is String && value.trim().isNotEmpty;
}
