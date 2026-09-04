import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';

import 'helpers/fake_pcm_audio_output_player.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test(
      'waits for server voice acknowledgement and uses the new mode on restart',
      () async {
    final (controller, requests, gateway) = voiceFixture();
    addTearDown(controller.dispose);
    await controller.start();
    expect(controller.status, RealtimeStatus.active,
        reason: controller.message);
    expect(requests.single['voiceOutput'], false);
    final applying =
        controller.setAutoSpeakTranslation(true, voiceOutputMode: 'natural');
    await pumpEventQueue();
    expect(controller.autoSpeakTranslation, false);
    expect(controller.voiceOutputUpdating, true);
    gateway.ack.complete();
    expect(await applying, true);
    expect(controller.autoSpeakTranslation, true);
    await controller.stop();
    await controller.start();
    expect(requests.last['voiceOutput'], true);
    expect(requests.last['voice'],
        {'mode': 'preset', 'presetId': 'zh_female_natural'});
  });

  test(
      'keeps captions active and the old mode if the server rejects enabling speech',
      () async {
    final (controller, requests, gateway) = voiceFixture();
    addTearDown(controller.dispose);
    await controller.start();
    final applying =
        controller.setAutoSpeakTranslation(true, voiceOutputMode: 'natural');
    gateway.ack.completeError(StateError('voice setting rejected'));
    expect(await applying, false);
    expect(controller.status, RealtimeStatus.active);
    expect(controller.autoSpeakTranslation, false);
    expect(controller.message, contains('voice setting rejected'));
    await controller.stop();
    await controller.start();
    expect(requests.last['voiceOutput'], false);
  });

  test(
      'reports a native playback failure and continues later captions and audio',
      () async {
    final first = Completer<PcmAudioOutputResult>();
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: first);
    final controller = realtimeControllerForTest(repository, FakeAudioCapture(),
        pcmAudioOutputPlayer: player, autoSpeakTranslation: true);
    addTearDown(controller.dispose);
    await controller.start();
    repository.emit(audioOutput(1));
    await pumpEventQueue();
    first.completeError(PlatformException(
        code: 'pcm_audio_decode_failed', message: 'decode failed'));
    await pumpEventQueue();
    expect(controller.status, RealtimeStatus.active);
    expect(controller.message, contains('decode failed'));
    expect(controller.message, contains('字幕已保留'));
    repository.emit(const GatewayRealtimeEvent(
      type: 'error',
      sessionId: 'sess_1',
      stage: 'tts',
      code: 'provider_unavailable',
      message: 'TTS request failed',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'caption',
      text: 'caption survived',
      language: 'en',
    ));
    repository.emit(audioOutput(2));
    await pumpEventQueue();
    expect(controller.status, RealtimeStatus.active);
    expect(controller.segments.single.translatedText, 'caption survived');
    expect(player.played.length, 2);
  });

  test('plays 20 online TTS outputs in gateway order', () async {
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer();
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
    );
    addTearDown(controller.dispose);
    await controller.start();

    for (var index = 1; index <= 20; index += 1) {
      repository.emit(audioOutput(index));
    }
    await pumpEventQueue(times: 40);

    expect(
      player.played.map((entry) => entry.$1),
      List<String>.generate(20, (index) => 'audio_${index + 1}'),
    );
  });

  test('pause cancels current playback and drops queued outputs', () async {
    final firstPlayback = Completer<PcmAudioOutputResult>();
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: firstPlayback);
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    repository.emit(audioOutput(1));
    repository.emit(audioOutput(2));
    repository.emit(audioOutput(3));
    await pumpEventQueue();

    await controller.pause();
    firstPlayback.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
    await pumpEventQueue();

    expect(player.stopCount, greaterThanOrEqualTo(1));
    expect(player.played.map((entry) => entry.$1), ['audio_1']);
  });

  test('end cancels current playback and drops queued outputs', () async {
    final firstPlayback = Completer<PcmAudioOutputResult>();
    final repository = FakeRealtimeRepository();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: firstPlayback);
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    repository.emit(audioOutput(1));
    repository.emit(audioOutput(2));
    await pumpEventQueue();

    await controller.stop();
    firstPlayback.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
    await pumpEventQueue();

    expect(player.stopCount, greaterThanOrEqualTo(1));
    expect(player.played.map((entry) => entry.$1), ['audio_1']);
  });
}

(RealtimeController, List<Map<String, dynamic>>, _VoiceGateway) voiceFixture() {
  final requests = <Map<String, dynamic>>[];
  final gateway = _VoiceGateway();
  final api = RealtimeApiClient(
    baseUrl: Uri.parse('http://localhost'),
    voiceOutputMode: 'off',
    accountSessionStore: MemoryAccountSessionStore(const AccountSession(
      token: 'test-account-token',
      expiresAtIso: '2030-01-01T00:00:00Z',
    )),
    client: MockClient((request) async {
      if (request.url.path == '/realtime/sessions') {
        requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(
            jsonEncode({
              'sessionId': 'voice_${requests.length}',
              'realtimeToken': 'test-token',
              'endpoint': 'ws://localhost/realtime',
              'maxDurationSeconds': 60,
              'expiresAt': DateTime.now()
                  .add(const Duration(minutes: 5))
                  .toIso8601String(),
            }),
            200);
      }
      return http.Response('{}', 200);
    }),
  );
  return (
    RealtimeController(
      repository: RealtimeRepository(apiClient: api, gatewayClient: gateway),
      audioCapture: FakeAudioCapture(),
      config: AppConfig.fromEnvironment().copyWith(
        useDeviceAsr: false,
        useLocalSessions: false,
        useOnDeviceTranslation: false,
        realtimeVoiceOutputMode: 'off',
      ),
    ),
    requests,
    gateway
  );
}

class _VoiceGateway extends NoopRealtimeGatewayClient {
  final ack = Completer<void>();
  @override
  Future<void> connect(RealtimeSession session) async {}
  @override
  Future<void> setVoiceOutput(String sessionId, bool enabled,
          {String? presetId}) =>
      ack.future;
  @override
  Future<bool> endAndWait(String sessionId,
          {Duration timeout = const Duration(seconds: 1)}) async =>
      true;
}

GatewayRealtimeEvent audioOutput(int sequence) {
  return GatewayRealtimeEvent(
    type: 'audio.output',
    sessionId: 'sess_1',
    segmentId: 'seg_$sequence',
    format: 'pcm16',
    sampleRate: 24000,
    sequence: sequence,
    data: 'audio_$sequence',
  );
}
