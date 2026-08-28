import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('keeps routing captured audio while the connection is recovering',
      () async {
    final repository = FakeRealtimeRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);
    await controller.start();
    audio.emitFrame(1);
    await pumpEventQueue();
    repository.emit(const GatewayRealtimeEvent.connection(
      type: 'connection.reconnecting',
      message: 'Reconnecting (1/5)',
    ));
    await pumpEventQueue();

    audio.emitFrame(2);
    await pumpEventQueue();
    repository.emit(const GatewayRealtimeEvent.connection(
      type: 'connection.reconnected',
      message: 'Realtime connection restored',
      replayedAudioMs: 2400,
      droppedAudioMs: 1600,
    ));
    await pumpEventQueue();

    expect(repository.sentFrameSequences, [1, 2]);
    expect(controller.status, RealtimeStatus.active);
    expect(
      controller.message,
      'Realtime connection restored; replayed 2400 ms; missed 1600 ms',
    );
  });
}
