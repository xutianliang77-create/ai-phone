import 'dart:async';

import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';

class FakeSpeechOutputProvider implements SpeechOutputProvider {
  FakeSpeechOutputProvider({
    this.hangFirstSpeak = false,
    this.firstSpeakCompleter,
  });

  final bool hangFirstSpeak;
  final Completer<SpeechOutputResult>? firstSpeakCompleter;
  final spoken = <(String, String)>[];
  var stopCount = 0;

  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    spoken.add((text, language));
    if (firstSpeakCompleter != null && spoken.length == 1) {
      return firstSpeakCompleter!.future;
    }
    if (hangFirstSpeak && spoken.length == 1) {
      return Completer<SpeechOutputResult>().future;
    }
    return SpeechOutputResult(provider: 'fake', language: language);
  }

  @override
  Future<void> stop() async {
    stopCount += 1;
  }
}
