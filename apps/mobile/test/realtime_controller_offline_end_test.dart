import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('enters local ended state while network finalization is pending', () async {
    final repository = _DelayedEndRepository();
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    final stopping = controller.stop();
    await repository.endStarted;

    expect(controller.status, RealtimeStatus.ended);

    await controller.start();
    expect(repository.startedSessionIds, <String>['sess_1']);

    repository.releaseEnd();
    await stopping;
  });
}

class _DelayedEndRepository extends FakeRealtimeRepository {
  final _endStarted = Completer<void>();
  final _endGate = Completer<void>();

  Future<void> get endStarted => _endStarted.future;

  @override
  Future<void> end(
    String sessionId,
    List<SubtitleSegment> segments,
  ) async {
    endedSessionIds.add(sessionId);
    _endStarted.complete();
    await _endGate.future;
  }

  void releaseEnd() => _endGate.complete();
}
