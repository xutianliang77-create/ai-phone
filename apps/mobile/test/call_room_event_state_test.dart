import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_event_state.dart';

void main() {
  test('rejects stale pipeline and playback generations', () {
    final state = CallRoomEventState();
    expect(
        state.accept(
          pipelineGeneration: 3,
          playbackId: 'pb-1',
          playbackGeneration: 2,
        ),
        isTrue);
    expect(
        state.accept(
          pipelineGeneration: 2,
          playbackId: 'pb-1',
          playbackGeneration: 3,
        ),
        isFalse);
    expect(
        state.accept(
          pipelineGeneration: 3,
          playbackId: 'pb-1',
          playbackGeneration: 1,
        ),
        isFalse);
  });

  test('reset permits a fresh room generation sequence', () {
    final state = CallRoomEventState();
    expect(state.accept(pipelineGeneration: 5), isTrue);
    state.reset();
    expect(state.accept(pipelineGeneration: 1), isTrue);
  });
}
