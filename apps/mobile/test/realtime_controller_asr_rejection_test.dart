import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';
import 'helpers/fake_pcm_audio_output_player.dart';
import 'realtime_controller_endpoint_test.dart' show PublicRepository, Capture;

void main() {
  test('rejected ASR final retires its draft without stopping the public session or playing stale PCM', () async {
    final repo = PublicRepository(), player = FakePcmAudioOutputPlayer();
    final controller = realtimeControllerForTest(repo, Capture(),
        pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
    Future<void> emit(GatewayRealtimeEvent event) async {
      repo.emit(event);
      await pumpEventQueue();
    }
    try {
      await controller.start();
      await emit(const GatewayRealtimeEvent(type:'transcript.partial', sessionId:'sess_1',
          segmentId:'bad', revision:0, text:'先前的草稿', language:'auto'));
      await emit(const GatewayRealtimeEvent(type:'transcript.final', sessionId:'sess_1',
          segmentId:'bad', revision:1, text:'', language:'auto'));
      await emit(const GatewayRealtimeEvent(type:'translation.failed', sessionId:'sess_1',
          segmentId:'bad', revision:1, language:'en', stage:'asr', retryable:false,
          message:'本段识别结果出现异常重复，未发送翻译或朗读；会话继续。'));
      expect(controller.status, RealtimeStatus.active);
      expect(controller.segments, isEmpty);
      expect(controller.message, contains('异常重复'));
      await emit(const GatewayRealtimeEvent(type:'audio.output', sessionId:'sess_1',
          segmentId:'bad', revision:1, sequence:0, format:'pcm16', sampleRate:24000,
          data:'stale', isFinal:true));
      expect(player.played, isEmpty);
      await emit(const GatewayRealtimeEvent(type:'transcript.final', sessionId:'sess_1',
          segmentId:'good', revision:1, text:'接下来继续测试。', language:'zh'));
      await emit(const GatewayRealtimeEvent(type:'translation.final', sessionId:'sess_1',
          segmentId:'good', revision:1, text:'Continue the test.', language:'en'));
      await emit(const GatewayRealtimeEvent(type:'audio.output', sessionId:'sess_1',
          segmentId:'good', revision:1, sequence:0, format:'pcm16', sampleRate:24000,
          data:'normal', isFinal:true));
      expect(controller.status, RealtimeStatus.active);
      expect(controller.segments.single.sourceText, '接下来继续测试。');
      expect(controller.segments.single.translatedText, 'Continue the test.');
      expect(player.played.map((p) => p.$1), ['normal']);
      expect(controller.message, isNull);
    } finally {
      await controller.disposeAsync();
    }
  });
}
