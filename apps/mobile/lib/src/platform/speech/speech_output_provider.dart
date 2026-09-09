import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'system_speech_voice.dart';
export 'system_speech_voice.dart';

class SpeechOutputResult {
  const SpeechOutputResult({
    required this.provider,
    required this.language,
    this.voice,
    this.timings = const {},
  });

  final String provider;
  final String language;
  final SystemSpeechVoice? voice;
  final Map<String, double> timings;
}

abstract class SpeechOutputProvider {
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  });

  Future<void> stop();
}

class SystemSpeechOutputProvider
    implements SpeechOutputProvider, SpeechOutputDiagnostics {
  SystemSpeechOutputProvider({MethodChannel? channel, TargetPlatform? platform})
      : _channel = channel ?? const MethodChannel(_channelName),
        _platform = platform ?? defaultTargetPlatform;

  static const _channelName = 'translation_mobile/speech_output';

  final MethodChannel _channel;
  final TargetPlatform _platform;
  int _generation = 0;
  int? _nativeGeneration;

  @override
  Future<SpeechVoiceAvailability> availability(String language) async {
    if (_platform != TargetPlatform.iOS) {
      return const SpeechVoiceAvailability(
          canSpeak: false, reason: 'ios_voice_inspection_unavailable');
    }
    try {
      final data = await _channel.invokeMapMethod<String, Object?>(
              'isAvailable', {'language': language}) ??
          const {};
      final voice = SystemSpeechVoice.fromPayload(data, language);
      final ready = data['canSpeak'] == true && voice != null;
      return SpeechVoiceAvailability(
          canSpeak: ready,
          voice: ready ? voice : null,
          reason: data['canSpeak'] == true && !ready
              ? 'speech_voice_metadata_invalid'
              : data['reason'] as String? ?? 'speech_voice_unavailable');
    } on MissingPluginException {
      return const SpeechVoiceAvailability(
          canSpeak: false, reason: 'speech_voice_diagnostics_unavailable');
    } on PlatformException catch (error) {
      return SpeechVoiceAvailability(canSpeak: false, reason: error.code);
    }
  }

  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    final generation = ++_generation;
    final availabilityWatch = Stopwatch()..start();
    SystemSpeechVoice? expectedVoice;
    if (_platform == TargetPlatform.iOS) {
      // Preserve native replacement semantics even if the new voice check fails.
      if (_nativeGeneration != null) await _channel.invokeMethod<void>('stop');
      if (generation != _generation) {
        throw PlatformException(code: 'speech_cancelled');
      }
      final ready = await availability(language);
      if (generation != _generation) {
        throw PlatformException(code: 'speech_cancelled');
      }
      ready.requireReady();
      expectedVoice = ready.voice;
    }
    Map<String, Object?>? result;
    availabilityWatch.stop();
    final platformWatch = Stopwatch()..start();
    if (_platform == TargetPlatform.iOS) _nativeGeneration = generation;
    try {
      result = await _channel.invokeMapMethod<String, Object?>('speak', {
        'text': text,
        'language': language,
        if (expectedVoice != null) 'voiceIdentifier': expectedVoice.identifier,
      });
    } finally {
      platformWatch.stop();
      if (_nativeGeneration == generation) _nativeGeneration = null;
    }
    if (generation != _generation) {
      throw PlatformException(code: 'speech_cancelled');
    }
    if (_platform == TargetPlatform.iOS) {
      final voice = SystemSpeechVoice.fromPayload(result ?? const {}, language);
      if (voice == null ||
          voice.identifier != expectedVoice?.identifier ||
          result?['completion'] != 'finished') {
        throw PlatformException(
            code: 'speech_voice_confirmation_failed',
            message:
                'System speech did not confirm the selected voice and language.');
      }
      return SpeechOutputResult(
          provider: 'ios_system_tts',
          language: language,
          voice: voice,
          timings: {
            'voiceAvailabilityMs': availabilityWatch.elapsedMicroseconds / 1000,
            'platformSpeakMs': platformWatch.elapsedMicroseconds / 1000,
            if (result?['timing'] case final Map timing)
              for (final key in [
                'nativeTotalMs',
                'nativeRequestToStartMs',
                'nativeSpeakingMs'
              ])
                if (timing[key] case final num value
                    when value.isFinite && value >= 0)
                  key: value.toDouble(),
          });
    }
    return SpeechOutputResult(
      provider: result?['provider'] as String? ?? 'system_tts',
      language: result?['language'] as String? ?? language,
    );
  }

  @override
  Future<void> stop() async {
    _generation++;
    await _channel.invokeMethod<void>('stop');
  }
}
