part of '../realtime_controller_test.dart';

void registerLateControllerCases() {
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
}
