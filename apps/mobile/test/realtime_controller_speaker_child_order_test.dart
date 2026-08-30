import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('inserts a late speaker child into the live chronological timeline',
      () async {
    final repository = FakeRealtimeRepository();
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
    );
    addTearDown(controller.dispose);
    await controller.start();

    repository.emit(_event('parent', 'speaker_1', 0, 1000));
    repository.emit(_event('next', 'speaker_2', 1400, 2200));
    repository.emit(_event('child', 'speaker_2', 1000, 1600));
    await pumpEventQueue();

    expect(controller.segments.map((segment) => segment.id), <String>[
      'parent',
      'child',
      'next',
    ]);
  });
}

GatewayRealtimeEvent _event(
  String segmentId,
  String speakerId,
  int startMs,
  int endMs,
) {
  return GatewayRealtimeEvent(
    type: 'transcript.final',
    sessionId: 'sess_1',
    segmentId: segmentId,
    revision: 1,
    text: segmentId,
    language: 'zh',
    speaker: SpeakerAttribution(
      speakerId: speakerId,
      role: 'speaker',
      source: 'diarization',
    ),
    timing: SegmentTiming(
      startMs: startMs,
      endMs: endMs,
      source: 'model',
    ),
  );
}
