import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('ignores late gateway events after stop', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.stop();
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'late_1',
      text: 'late text',
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.ended);
    expect(controller.segments, isEmpty);
    expect(repository.endedSessionIds, <String>['sess_1']);
  });

  test('ignores stale events from a previous session after restart', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.stop();
    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'old_1',
      text: 'old text',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_2',
      segmentId: 'new_1',
      text: 'new text',
    ));
    await pumpEventQueue();

    expect(repository.startedSessionIds, <String>['sess_1', 'sess_2']);
    expect(controller.segments.length, 1);
    expect(controller.segments.single.id, 'new_1');
    expect(controller.segments.single.sourceText, 'new text');
    expect(controller.segments.single.translatedText, '');
  });

  test('ignores gateway silence marker captions and translations', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'sil_1',
      text: '<sil>',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'sil_1',
      text: '<sil>',
      language: 'en',
    ));
    await pumpEventQueue();

    expect(controller.segments, isEmpty);
  });

  test('strips gateway silence markers from mixed text', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'mix_1',
      text: 'hello <|nospeech|> world',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'mix_1',
      text: '你好 <sil>',
      language: 'zh',
    ));
    await pumpEventQueue();

    expect(controller.segments.single.sourceText, 'hello world');
    expect(controller.segments.single.translatedText, '你好');
  });

  test('shows gateway provider error stage in the status message', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'error',
      sessionId: 'sess_1',
      code: 'provider_unavailable',
      stage: 'asr',
      provider: 'hymt2_self_hosted',
      retryable: true,
      message: 'Realtime audio processing failed',
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.ended);
    expect(controller.message, contains('ASR 识别'));
    expect(controller.message, contains('hymt2_self_hosted'));
    expect(controller.message, contains('可重试'));
  });

  test('accepts gateway flush events while stopping', () async {
    final repository = FakeRealtimeRepository(emitTailOnEnd: true);
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.stop();
    expect(controller.segments.single.sourceText, 'tail audio');
    expect(controller.segments.single.translatedText, '尾句已翻译');
  });

  test('stop is idempotent and stops sending audio frames', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    audio.emitFrame(1);
    await pumpEventQueue();
    await controller.stop();
    await controller.stop();
    audio.emitFrame(2);
    await pumpEventQueue();

    expect(repository.sentFrameSequences, <int>[1]);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(audio.stopCalls, 1);
  });

  test('ends session even when audio stop fails', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture(failStop: true);
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.stop();

    expect(controller.status, RealtimeStatus.ended);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(audio.stopCalls, 1);
  });

  test('stops locally when gateway ends because usage is exhausted', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    audio.emitFrame(1);
    await pumpEventQueue();
    repository.emit(const GatewayRealtimeEvent(
      type: 'session.ended',
      sessionId: 'sess_1',
      reason: 'quota_exhausted',
      billableSeconds: 300,
      remainingSeconds: 0,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.ended);
    expect(controller.message, contains('剩余分钟已用完'));
    expect(repository.endedSessionIds, isEmpty);
    expect(repository.closeRealtimeCalls, 1);
    expect(audio.stopCalls, 1);
    audio.emitFrame(2);
    await pumpEventQueue();
    expect(repository.sentFrameSequences, <int>[1]);
  });

  test('shows low balance usage ticks without stopping online realtime',
      () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'usage.tick',
      sessionId: 'sess_1',
      billableSeconds: 285,
      remainingSeconds: 15,
      lowBalance: true,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.listening);
    expect(controller.lowBalance, isTrue);
    expect(controller.remainingSeconds, 15);

    repository.emit(const GatewayRealtimeEvent(
      type: 'usage.tick',
      sessionId: 'sess_1',
      billableSeconds: 10,
      remainingSeconds: 120,
      lowBalance: false,
    ));
    await pumpEventQueue();

    expect(controller.lowBalance, isFalse);
    expect(controller.remainingSeconds, 120);
  });

  test('ends created session when audio start fails', () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture(failStart: true, failStop: true);
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    await controller.start();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.ended);
    expect(controller.message, contains('microphone start failed'));
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(audio.stopCalls, 1);
  });
}
