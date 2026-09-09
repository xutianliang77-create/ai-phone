part of 'realtime_controller.dart';

extension RealtimeControllerVoiceResources on RealtimeController {
  List<RealtimeLocalResource> _voiceResourceTargets() {
    final pair = _config.autoReverseTargetLanguage
        ? explicitRealtimeLanguagePair(_config)
        : null;
    final languages = pair != null
        ? {pair.source, pair.target}
        : _config.autoReverseTargetLanguage
            ? <String>{}
            : {_config.targetLanguage};
    return [
      for (final language in languages)
        RealtimeLocalResource(
            kind: LocalResourceKind.speech, sourceLanguage: language)
    ];
  }

  Future<RealtimeLocalResource> _readVoiceResource(
      RealtimeLocalResource item) async {
    final provider = _speechOutputProvider;
    if (provider is! SpeechOutputDiagnostics) {
      return item.observed(LocalResourcePhase.unsupported,
          'speech_voice_diagnostics_unavailable');
    }
    final ready = await (provider as SpeechOutputDiagnostics)
        .availability(item.sourceLanguage);
    if (ready.canSpeak &&
        ready.voice != null &&
        speechVoiceLanguageMatches(
            ready.voice!.language, item.sourceLanguage)) {
      return item.observed(
          LocalResourcePhase.ready, 'voice_available_on_device',
          voice: ready.voice);
    }
    return item.observed(LocalResourcePhase.failed,
        ready.canSpeak ? 'speech_voice_metadata_invalid' : ready.reason);
  }
}
