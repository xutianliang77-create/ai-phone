import 'dart:async';

import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';

class FakePcmAudioOutputPlayer implements PcmAudioOutputPlayer {
  FakePcmAudioOutputPlayer({this.firstPlayCompleter});

  final Completer<PcmAudioOutputResult>? firstPlayCompleter;
  final played = <(String, int)>[];
  var stopCount = 0;

  @override
  Future<PcmAudioOutputResult> play({
    required String data,
    required int sampleRate,
  }) async {
    played.add((data, sampleRate));
    if (firstPlayCompleter != null && played.length == 1) {
      return firstPlayCompleter!.future;
    }
    return PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: sampleRate,
    );
  }

  @override
  Future<void> stop() async {
    stopCount += 1;
  }
}
