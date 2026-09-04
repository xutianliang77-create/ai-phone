import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('new recognition revision clears stale translation until replacement',
      () async {
    final repository = FakeRealtimeRepository();
    final controller =
        realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      turnId: 'turn_1',
      revision: 6,
      text: '我会整。',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      turnId: 'turn_1',
      revision: 6,
      text: 'I will...',
      language: 'en',
      provider: 'hymt2',
      model: 'Hy-MT2',
    ));
    await pumpEventQueue();
    expect(controller.segments.single.translatedText, 'I will...');

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      turnId: 'turn_1',
      revision: 7,
      text: '我会整理会议纪要',
      language: 'zh',
    ));
    await pumpEventQueue();
    expect(controller.segments.single.sourceText, '我会整理会议纪要');
    expect(controller.segments.single.translatedText, isEmpty);
    expect(controller.segments.single.provider, isNull);
    expect(controller.segments.single.model, isNull);

    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      turnId: 'turn_1',
      revision: 6,
      text: 'stale translation',
      language: 'en',
    ));
    await pumpEventQueue();
    expect(controller.segments.single.translatedText, isEmpty);

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      turnId: 'turn_1',
      revision: 7,
      text: '我会整理会议纪要。',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      turnId: 'turn_1',
      revision: 7,
      text: 'I will organize the meeting minutes.',
      language: 'en',
      provider: 'hymt2',
      model: 'Hy-MT2',
    ));
    await pumpEventQueue();
    expect(
      controller.segments.single.translatedText,
      'I will organize the meeting minutes.',
    );
  });

  test('empty final tombstone removes an absorbed continuation partial',
      () async {
    final repository = FakeRealtimeRepository();
    final controller =
        realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'seg_2',
      revision: 2,
      text: '整理会议纪要',
      language: 'zh',
    ));
    await pumpEventQueue();
    expect(controller.segments.single.id, 'seg_2');

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'seg_2',
      revision: 3,
      text: '',
      language: 'zh',
    ));
    await pumpEventQueue();
    expect(controller.segments, isEmpty);
  });
}
