import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('replaces cumulative revised partials without duplicating text', () async {
    final repository = FakeRealtimeRepository();
    final controller =
        realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 0,
      text: 'No carga',
      language: 'es',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 1,
      text: 'No carga y',
      language: 'es',
    ));
    await pumpEventQueue();

    expect(controller.segments.single.sourceText, 'No carga y');
    expect(controller.segments.single.revision, 1);
  });

  test('keeps appending legacy delta partials without revisions', () async {
    final repository = FakeRealtimeRepository();
    final controller =
        realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      text: 'hello ',
      language: 'en',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      text: 'world',
      language: 'en',
    ));
    await pumpEventQueue();

    expect(controller.segments.single.sourceText, 'helloworld');
  });

  test('authoritative final replaces the stable partial revision', () async {
    final repository = FakeRealtimeRepository();
    final controller =
        realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();

    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.partial',
      sessionId: 'sess_1',
      segmentId: 'qwen3_seg_1',
      revision: 0,
      text: '今天开会',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'qwen3_seg_1',
      revision: 1,
      text: '今天开会讨论产品计划。',
      language: 'zh',
    ));
    await pumpEventQueue();

    expect(controller.segments.single.sourceText, '今天开会讨论产品计划。');
    expect(controller.segments.single.revision, 1);
  });
}
