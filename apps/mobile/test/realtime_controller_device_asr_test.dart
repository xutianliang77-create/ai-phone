import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

part 'helpers/realtime_device_asr_fakes.dart';

void main() {
  test('starts device ASR and keeps its final text on the local path',
      () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider();
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    provider.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
      isFinal: true,
      confidence: 0.9,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.active);
    expect(provider.calls, <String>[
      'availability',
      'prepare',
      'requestPermission',
      'start',
    ]);
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'hello');
  });

  test('pauses and resumes device ASR without new session', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(
      onStopSegment: const AsrTextSegment(
        id: 'pause_tail_1',
        text: 'pause tail',
        language: 'en',
        isFinal: true,
      ),
    );
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'pause tail');
    await controller.start();

    expect(controller.status, RealtimeStatus.active);
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.pausedSessionIds, <String>['sess_1']);
    expect(repository.resumedSessionIds, <String>['sess_1']);
    expect(provider.startCalls, 2);
    expect(provider.stopCalls, 1);
  });

  test('ends session when device ASR pause fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(failStop: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.failed);
    expect(controller.message, contains('device ASR stop failed'));
    expect(repository.pausedSessionIds, isEmpty);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(provider.stopCalls, 2);
  });

  test('ends session when device ASR resume fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(failResumeStart: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    await controller.start();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.failed);
    expect(controller.message, contains('device ASR start failed'));
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.pausedSessionIds, <String>['sess_1']);
    expect(repository.resumedSessionIds, <String>['sess_1']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(provider.startCalls, 2);
  });

  test('sends final ASR text emitted just after native stop returns', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(
      onStopSegment: const AsrTextSegment(
        id: 'tail_1',
        text: 'final tail',
        language: 'en',
        isFinal: true,
      ),
    );
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.stop();

    expect(controller.status, RealtimeStatus.ended);
    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'final tail');
    expect(repository.endedSessionIds, <String>['sess_1']);
  });

  test('ends created session when device ASR start fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(failStart: true, failStop: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.failed);
    expect(controller.message, contains('device ASR start failed'));
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(provider.startCalls, 2);
    expect(provider.stopCalls, 2);
  });

  test('online mode ignores a stale device-ASR flag and starts no device model',
      () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider();
    final controller = _controller(repository, provider, local: false);
    addTearDown(controller.dispose);

    await controller.start();

    expect(controller.status, RealtimeStatus.active);
    expect(provider.calls, isEmpty);
    expect(repository.startedSessionIds, <String>['sess_1']);
  });
}
