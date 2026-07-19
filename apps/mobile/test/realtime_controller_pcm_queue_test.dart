import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';

import 'helpers/fake_pcm_audio_output_player.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('plays 20 online TTS outputs in gateway order', () async {
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer();
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
    );
    addTearDown(controller.dispose);
    await controller.start();

    for (var index = 1; index <= 20; index += 1) {
      repository.emit(audioOutput(index));
    }
    await pumpEventQueue(times: 40);

    expect(
      player.played.map((entry) => entry.$1),
      List<String>.generate(20, (index) => 'audio_${index + 1}'),
    );
  });

  test('pause cancels current playback and drops queued outputs', () async {
    final firstPlayback = Completer<PcmAudioOutputResult>();
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: firstPlayback);
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    repository.emit(audioOutput(1));
    repository.emit(audioOutput(2));
    repository.emit(audioOutput(3));
    await pumpEventQueue();

    await controller.pause();
    firstPlayback.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
    await pumpEventQueue();

    expect(player.stopCount, greaterThanOrEqualTo(1));
    expect(player.played.map((entry) => entry.$1), ['audio_1']);
  });

  test('end cancels current playback and drops queued outputs', () async {
    final firstPlayback = Completer<PcmAudioOutputResult>();
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: firstPlayback);
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    repository.emit(audioOutput(1));
    repository.emit(audioOutput(2));
    await pumpEventQueue();

    await controller.stop();
    firstPlayback.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
    await pumpEventQueue();

    expect(player.stopCount, greaterThanOrEqualTo(1));
    expect(player.played.map((entry) => entry.$1), ['audio_1']);
  });
}

GatewayRealtimeEvent audioOutput(int sequence) {
  return GatewayRealtimeEvent(
    type: 'audio.output',
    sessionId: 'sess_1',
    segmentId: 'seg_$sequence',
    format: 'pcm16',
    sampleRate: 24000,
    sequence: sequence,
    data: 'audio_$sequence',
  );
}
