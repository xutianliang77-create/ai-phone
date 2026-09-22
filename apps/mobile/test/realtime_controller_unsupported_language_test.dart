import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test(
      'unsupported source notice withdraws draft but keeps microphone and session active',
      () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);
    await controller.start();
    final stopsBefore = audio.stopCalls;
    repository.emit(const GatewayRealtimeEvent(
        type: 'transcript.partial',
        sessionId: 'sess_1',
        segmentId: 'unsupported',
        revision: 0,
        language: 'en',
        text: 'temporary draft'));
    repository.emit(const GatewayRealtimeEvent(
        type: 'transcript.final',
        sessionId: 'sess_1',
        segmentId: 'unsupported',
        revision: 1,
        language: 'en',
        text: ''));
    repository.emit(const GatewayRealtimeEvent(
        type: 'translation.failed',
        sessionId: 'sess_1',
        segmentId: 'unsupported',
        revision: 1,
        language: 'zh',
        stage: 'translation',
        retryable: false,
        message: '已识别到当前版本暂未接入的语种（da），此段未翻译；会话继续。'));
    await pumpEventQueue();
    expect(controller.status.name, 'active');
    expect(audio.stopCalls, stopsBefore);
    expect(controller.message, contains('会话继续'));
    expect(controller.segments.any((s) => s.sourceText.contains('temporary')),
        isFalse);
    expect(controller.segments.every((s) => s.translatedText.isEmpty), isTrue);
    repository.emit(const GatewayRealtimeEvent(
        type: 'transcript.final',
        sessionId: 'sess_1',
        segmentId: 'next',
        revision: 1,
        language: 'en',
        text: 'Good morning.'));
    repository.emit(const GatewayRealtimeEvent(
        type: 'translation.final',
        sessionId: 'sess_1',
        segmentId: 'next',
        revision: 1,
        language: 'zh',
        text: '早上好。'));
    await pumpEventQueue();
    expect(controller.status.name, 'active');
    expect(controller.segments.last.translatedText, '早上好。');
    expect(audio.startCalls, 1);
  });
}
