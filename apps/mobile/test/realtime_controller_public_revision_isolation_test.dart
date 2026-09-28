import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';
import 'helpers/realtime_controller_test_helpers.dart';
import 'helpers/fake_pcm_audio_output_player.dart';
import 'realtime_controller_endpoint_test.dart' show PublicRepository, Capture;

void main() {
  test('same-language wire terminal retains source without invented translation or playback', () async {
    final repo=PublicRepository(),player=FakePcmAudioOutputPlayer();
    final controller=realtimeControllerForTest(repo,Capture(),pcmAudioOutputPlayer:player,autoSpeakTranslation:true);
    try {
      await controller.start();
      repo.emit(GatewayRealtimeEvent.fromJson({'type':'transcript.final','sessionId':'sess_1','segmentId':'same',
        'revision':1,'text':'Already English.','language':'en'}));
      repo.emit(GatewayRealtimeEvent.fromJson({'type':'translation.skipped','sessionId':'sess_1','segmentId':'same',
        'revision':1,'language':'en','reason':'same_language'}));
      await pumpEventQueue();
      expect(controller.segments.single.sourceText,'Already English.');
      expect(controller.segments.single.translatedText,isEmpty);
      expect(controller.segments.single.stage,'translation_skipped');
      expect(player.played,isEmpty);
    } finally { await controller.disposeAsync(); }
  });
  for (final correctedActive in [false, true]) {
    test('revision cancellation preserves unrelated PCM, active=$correctedActive', () async {
      final repo = PublicRepository(), capture = Capture();
      final blocked = Completer<PcmAudioOutputResult>();
      final player = FakePcmAudioOutputPlayer(firstPlayCompleter: blocked);
      final controller = realtimeControllerForTest(repo, capture,
          pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
      Future<void> emit(GatewayRealtimeEvent e) async { repo.emit(e); await pumpEventQueue(); }
      try {
        await controller.start();
        for (final id in ['a', 'b', 'c']) {
          await emit(GatewayRealtimeEvent(type:'transcript.final', sessionId:'sess_1', segmentId:id,
              revision:1, text:'原文$id', language:'zh'));
          await emit(GatewayRealtimeEvent(type:'translation.final', sessionId:'sess_1', segmentId:id,
              revision:1, text:'Translation $id', language:'en'));
          await emit(GatewayRealtimeEvent(type:'audio.output', sessionId:'sess_1', segmentId:id,
              revision:1, sequence:1, format:'pcm16', sampleRate:24000, data:'audio_$id', isFinal:true));
        }
        await emit(GatewayRealtimeEvent(type:'transcript.final', sessionId:'sess_1',
            segmentId:correctedActive?'a':'b', revision:2, text:'修订原文', language:'zh'));
        expect(player.stopCount, correctedActive?1:0);
        if (!correctedActive) blocked.complete(const PcmAudioOutputResult(provider:'fake',sampleRate:24000));
        await pumpEventQueue();
        expect(player.played.map((p)=>p.$1), correctedActive?['audio_a','audio_b','audio_c']:['audio_a','audio_c']);
        await emit(const GatewayRealtimeEvent(type:'audio.output', sessionId:'sess_1', segmentId:'c',
            revision:1, sequence:2, format:'pcm16', sampleRate:24000, data:'audio_c_more', isFinal:true));
        expect(player.played.last.$1, 'audio_c_more');
      } finally {
        if (!blocked.isCompleted) blocked.complete(const PcmAudioOutputResult(provider:'fake',sampleRate:24000));
        await controller.disposeAsync();
      }
    });
  }
}
