import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/public_creation_request_store.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/audio/device_speaker_diarizer.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';
import 'helpers/realtime_controller_test_helpers.dart';
import 'helpers/fake_pcm_audio_output_player.dart';
import 'realtime_controller_endpoint_test.dart' show PublicRepository, Capture;
import 'public_creation_client_test.dart' as creation;

GatewayRealtimeEvent translation(String id, int revision) =>
    GatewayRealtimeEvent(
        type: 'translation.final',
        sessionId: 'sess_1',
        segmentId: id,
        revision: revision,
        text: 'Synthetic translation.',
        language: 'en');
GatewayRealtimeEvent chunk(String id, int revision, int sequence) =>
    GatewayRealtimeEvent(
        type: 'audio.output',
        sessionId: 'sess_1',
        segmentId: id,
        revision: revision,
        sequence: sequence,
        format: 'pcm16',
        sampleRate: 24000,
        data: 'synthetic_chunk_$sequence',
        isFinal: sequence >= 2);

class HangingStop extends FakePcmAudioOutputPlayer {
  final blocker = Completer<void>();
  bool hang = false;
  @override
  Future<void> stop() async {
    stopCount++;
    if (hang) await blocker.future;
  }
}

void main() {
  test('CONTROL two current PCM chunks play in order without barge-in',
      () async {
    final repo = PublicRepository(),
        capture = Capture(),
        player = FakePcmAudioOutputPlayer();
    final controller = realtimeControllerForTest(repo, capture,
        pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
    try {
      await controller.start();
      repo.emit(translation('A', 1));
      repo.emit(chunk('A', 1, 1));
      repo.emit(chunk('A', 1, 2));
      await pumpEventQueue();
      expect(player.played.length, 2);
    } finally {
      await controller.disposeAsync();
    }
  });
  for (final scenario in ['cancelled-old', 'new-segment', 'new-revision']) {
    test(
        '${scenario == 'cancelled-old' ? 'F3' : 'CONTROL'} barge-in followed by $scenario PCM',
        () async {
      final repo = PublicRepository(),
          capture = Capture(),
          first = Completer<PcmAudioOutputResult>();
      final player = FakePcmAudioOutputPlayer(firstPlayCompleter: first);
      final controller = realtimeControllerForTest(repo, capture,
          pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
      try {
        await controller.start();
        repo.emit(translation('A', 1));
        repo.emit(chunk('A', 1, 1));
        await pumpEventQueue();
        expect(player.played.length, 1);
        capture.emit(1, endpoint: true);
        await pumpEventQueue();
        expect(player.stopCount, greaterThan(0));
        if (scenario == 'cancelled-old') {
          repo.emit(chunk('A', 1, 2));
        }
        if (scenario == 'new-segment') {
          repo.emit(translation('B', 1));
          repo.emit(chunk('B', 1, 2));
        }
        if (scenario == 'new-revision') {
          repo.emit(translation('A', 2));
          repo.emit(chunk('A', 2, 2));
        }
        await pumpEventQueue();
        expect(player.played.length, scenario == 'cancelled-old' ? 1 : 2,
            reason:
                'Cancel must reject old audio without blocking valid new translations');
      } finally {
        if (!first.isCompleted) {
          first.complete(
              const PcmAudioOutputResult(provider: 'fake', sampleRate: 24000));
        }
        await pumpEventQueue();
        await controller.disposeAsync();
      }
    });
  }
  test('CONTROL ordinary stop stops physical capture', () async {
    final repo = PublicRepository(),
        capture = Capture(),
        player = FakePcmAudioOutputPlayer();
    final controller = realtimeControllerForTest(repo, capture,
        pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
    try {
      await controller.start();
      final before = capture.stopCalls;
      await controller.stop().timeout(const Duration(seconds: 1));
      expect(capture.stopCalls, greaterThan(before));
    } finally {
      await controller.disposeAsync();
    }
  });
  test('F2 a stalled playback stop must not block physical capture stop',
      () async {
    final repo = PublicRepository(),
        capture = Capture(),
        player = HangingStop();
    final controller = realtimeControllerForTest(repo, capture,
        pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
    await controller.start();
    final before = capture.stopCalls;
    player.hang = true;
    final stopping = controller.stop();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    try {
      expect(capture.stopCalls, greaterThan(before),
          reason: 'Microphone stop cannot depend on an unbounded playback ACK');
    } finally {
      player.blocker.complete();
      await stopping;
      await controller.disposeAsync();
    }
  });
  test('F2 finalization remains bounded when playback stop never acknowledges',
      () async {
    final repo = PublicRepository(),
        capture = Capture(),
        player = HangingStop();
    final controller = realtimeControllerForTest(repo, capture,
        pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
    try {
      await controller.start();
      player.hang = true;
      await controller.stop().timeout(const Duration(seconds: 6));
      expect(capture.stopCalls, greaterThan(0));
      expect(controller.status, RealtimeStatus.ended);
    } finally {
      player.blocker.complete();
      await controller.disposeAsync();
    }
  });
  for (final readiness in [(false, false), (true, true), (false, true)]) {
    test(
        '${readiness.$1 == readiness.$2 ? 'CONTROL' : 'F6'} retry same request with speaker readiness ${readiness.$1} -> ${readiness.$2}',
        () async {
      final h = creation.Harness();
      h.context = {
        ...creation.offer('owner', false),
        'onDeviceSpeaker': {
          'available': true,
          'id': deviceSpeakerProfile,
          'revision': deviceSpeakerRevision,
          'maxSpeakers': 4,
          'execution': 'on_device',
          'anonymousOnly': true,
          'requiresLocalReadiness': true
        }
      };
      // Exercise a response timeout AFTER dispatch. A 60 ms total deadline
      // could instead expire during local file preparation on a loaded host,
      // leaving no original POST and never testing retry identity at all.
      h.post = (_) async => throw TimeoutException('Synthetic lost POST reply');
      final first = h.create(prepareSpeaker: () async => readiness.$1);
      http.Request? original;
      try {
        await expectLater(
            first.createSession(), throwsA(isA<TimeoutException>()));
        original = h.requests.singleWhere((r) => r.method == 'POST');
        first.close();
        h.post = null;
        final second = h.create(prepareSpeaker: () async => readiness.$2);
        await expectLater(second.createSession(), completes,
            reason: 'Readiness is not a change to user settings');
        final requests = h.requests.where((r) => r.method == 'POST').toList();
        expect(requests.length, 2);
        expect(requests.last.headers['idempotency-key'],
            original.headers['idempotency-key']);
        expect(requests.last.body, original.body,
            reason: 'Retry cannot silently add a new optional model');
      } finally {
        await pumpEventQueue();
        h.close();
      }
    });
  }
  for (final currentReady in [true, false]) {
    test(
        'F6 legacy speaker-enabled request keeps its identity when current readiness=$currentReady',
        () async {
      final h = creation.Harness();
      h.context = {
        ...creation.offer('owner', false),
        'onDeviceSpeaker': {
          'available': true,
          'id': deviceSpeakerProfile,
          'revision': deviceSpeakerRevision,
          'maxSpeakers': 4,
          'execution': 'on_device',
          'anonymousOnly': true,
          'requiresLocalReadiness': true
        }
      };
      try {
        h.post = (_) async => http.Response('{}', 503);
        await expectLater(
            h.create(prepareSpeaker: () async => true).createSession(),
            throwsException);
        final first = h.requests.singleWhere((r) => r.method == 'POST');
        final file = h.directory.listSync().whereType<File>().single;
        final record =
            jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
        record['settings'] =
            publicCreationHash([record['settings'], deviceSpeakerProfile]);
        record.remove('hash');
        record['hash'] = publicCreationHash(record);
        file.writeAsStringSync(jsonEncode(record));
        h.post = (r) async {
          if (r.url.path == '/realtime/creation-requests/query') {
            return currentReady
                ? http.Response(jsonEncode(creation.resolutionResponse(r, 'issued')), 200)
                : http.Response('{}', 503);
          }
          return http.Response(jsonEncode(creation.response(r, 'owner')), 200);
        };
        final client = h.create(prepareSpeaker: () async => currentReady);
        if (currentReady) {
          await client.createSession();
          final retry = h.requests.last;
          expect(retry.headers['idempotency-key'],
              first.headers['idempotency-key']);
          expect(retry.body, first.body);
        } else {
          await expectLater(
              client.createSession(),
              throwsA(isA<RealtimeApiException>()));
          expect(h.requests.where((r) => r.url.path == '/realtime/sessions'),
              hasLength(1));
          expect(jsonDecode(file.readAsStringSync())['key'],
              first.headers['idempotency-key']);
        }
      } finally {
        h.close();
      }
    });
  }
}
