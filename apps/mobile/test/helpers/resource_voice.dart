import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';

class ResourceVoice implements SpeechOutputProvider, SpeechOutputDiagnostics {
  bool ready = false;
  final checks = <String>[];
  int speaks = 0;
  @override
  Future<SpeechVoiceAvailability> availability(String language) async {
    checks.add(language);
    return SpeechVoiceAvailability(
        canSpeak: ready,
        reason:
            ready ? 'voice_available_on_device' : 'speech_voice_unavailable',
        voice: ready
            ? SystemSpeechVoice(
                identifier: 'com.apple.voice.test.$language',
                name: 'System test voice',
                language: language,
                quality: 1)
            : null);
  }

  @override
  Future<SpeechOutputResult> speak(
      {required String text, required String language}) async {
    speaks++;
    throw StateError('Resource check may not speak');
  }

  @override
  Future<void> stop() async {}
}
