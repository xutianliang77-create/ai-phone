import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/speech_capture_gate.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';
import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';
import 'helpers/realtime_controller_test_helpers.dart';
import 'helpers/fake_audio_session_coordinator.dart';
import 'helpers/fake_pcm_audio_output_player.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';

class PublicRepository extends FakeRealtimeRepository {
  final order = <String>[];
  bool public = true, boundaryAccepted = true;
  int captureSampleRate = 24000;
  String? speakerProfile;
  Completer<bool>? boundary;
  @override
  Future<RealtimeSession> startSession() async {
    final original = await super.startSession();
    return RealtimeSession(
        sessionId: original.sessionId,
        realtimeToken: original.realtimeToken,
        endpoint: original.endpoint,
        expiresAt: original.expiresAt,
        maxDurationSeconds: 60,
        deviceSpeakerProfile: speakerProfile,
        syncBinding: public
            ? ResultSyncBinding(
                deploymentId: 'public',
                ownerId: 'owner',
                modelPolicyRevision: 'p',
                captureSampleRate: captureSampleRate)
            : null);
  }

  @override
  bool sendAudio(String id, AudioFrame frame) {
    order.add('frame:${frame.sequence}');
    return super.sendAudio(id, frame);
  }

  @override
  Future<bool> commitAudioBoundary(String id) {
    order.add('boundary');
    return boundary?.future ?? Future.value(boundaryAccepted);
  }
}

class Capture extends FakeAudioCapture {
  final stream = StreamController<AudioFrame>.broadcast();
  bool tail = false;
  @override
  Stream<AudioFrame> get frames => stream.stream;
  void emit(int n, {bool endpoint = false, bool speechStart = false}) => stream.add(AudioFrame(
      sequence: n,
      timestampMs: 1788883200000,
      sampleRate: 24000,
      bytes: List<int>.filled(4800, 0),
      endsSegment: endpoint, startsSegment: speechStart));
  @override
  Future<void> stop() async {
    await super.stop();
    if (tail) {
      tail = false;
      emit(99, endpoint: true);
      await Future<void>.delayed(Duration.zero);
    }
  }

  @override
  Future<void> dispose() async {
    await stream.close();
    await super.dispose();
  }
}

class VoiceToggleRepository extends PublicRepository {
  @override
  Future<void> setVoiceOutput(String sessionId, bool enabled, {String? presetId}) async {}
}

void main() {
  test('muting and route recovery preserve the same spoken reference; a new silent session does not inherit it', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final capture = Capture(), audio = FakeAudioSessionCoordinator();
    final controller = realtimeControllerForTest(VoiceToggleRepository(), capture,
      autoSpeakTranslation:true, audioSessionCoordinator:audio);
    try {
      await controller.start();
      expect(capture.startedConfigs.last.publicPlaybackReference,isTrue);
      expect(await controller.setAutoSpeakTranslation(false),isTrue);
      audio.emit(const AudioSessionEvent(type:AudioSessionEventType.captureInvalidated));
      await pumpEventQueue();
      expect(capture.startedConfigs.length,2);
      expect(capture.startedConfigs.last.publicPlaybackReference,isTrue);
      expect(await controller.setAutoSpeakTranslation(true),isTrue);
      await controller.setAutoSpeakTranslation(false);
      await controller.stop(); await controller.start();
      expect(capture.startedConfigs.last.publicPlaybackReference,isFalse);
    } finally { await controller.disposeAsync(); debugDefaultTargetPlatformOverride = null; }
  });
  test('spoken iOS route rebuild retires playback without blocking capture or replaying the old chunk', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final repo = PublicRepository(), capture = Capture(), audio = FakeAudioSessionCoordinator();
    final completion = Completer<PcmAudioOutputResult>();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: completion);
    final controller = realtimeControllerForTest(repo, capture, autoSpeakTranslation:true,
      audioSessionCoordinator:audio, pcmAudioOutputPlayer:player);
    try {
      await controller.start();
      repo.emit(const GatewayRealtimeEvent(type:'translation.final',sessionId:'sess_1',segmentId:'voice',
        revision:1,text:'Hello there',language:'en'));
      repo.emit(const GatewayRealtimeEvent(type:'audio.output',sessionId:'sess_1',segmentId:'voice',
        revision:1,sequence:1,format:'pcm16',sampleRate:16000,data:'AAA='));
      await pumpEventQueue();
      expect(player.played.length,1);
      audio.emit(const AudioSessionEvent(type:AudioSessionEventType.captureInvalidated));
      await pumpEventQueue();
      expect(capture.startCalls,2);
      expect(player.stopCount,greaterThan(0));
      capture.emit(2); await pumpEventQueue();
      expect(repo.order,contains('frame:2'));
      completion.complete(const PcmAudioOutputResult(provider:'server_pcm_tts',sampleRate:16000));
      repo.emit(const GatewayRealtimeEvent(type:'audio.output',sessionId:'sess_1',segmentId:'voice',
        revision:1,sequence:2,format:'pcm16',sampleRate:16000,data:'AAA='));
      await pumpEventQueue();
      expect(player.played.length,1);
      expect(controller.message,isNull);
    } finally { await controller.disposeAsync(); debugDefaultTargetPlatformOverride = null; }
  });
  test('public spoken iOS meeting capture activates voice processing before native input starts', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      for (final spoken in [true, false]) {
        final capture = Capture(), controller = realtimeControllerForTest(
          PublicRepository(), capture, autoSpeakTranslation: spoken, realtimeMode: 'meeting');
        try {
          await controller.start();
          expect(capture.startedConfigs.single.echoCancel, spoken);
          expect(capture.startedConfigs.single.publicPlaybackReference, spoken);
        } finally { await controller.disposeAsync(); }
      }
    } finally { debugDefaultTargetPlatformOverride = null; }
  });
  test('only a spoken public session requests native playback reference', () async {
    for (final public in [true, false]) {
      for (final spoken in [true, false]) {
        final repo = PublicRepository()..public = public, capture = Capture();
        final controller = realtimeControllerForTest(repo, capture, autoSpeakTranslation: spoken);
        try {
          await controller.start();
          expect(capture.startedConfigs.single.publicPlaybackReference, public && spoken);
        } finally { await controller.disposeAsync(); }
      }
    }
  });
  test('a tail boundary alone does not interrupt a newly playing response', () async {
    final gate=SpeechCaptureGate(),capture=Capture();
    final controller=realtimeControllerForTest(PublicRepository(),capture,speechCaptureGate:gate);
    try {
      await controller.start();gate.beginPlayback(text:'current response',language:'en');
      capture.emit(1,endpoint:true);await pumpEventQueue();expect(gate.isPlaying,isTrue);
      capture.emit(2,speechStart:true);await pumpEventQueue();expect(gate.isPlaying,isFalse);
    } finally { await controller.disposeAsync(); }
  });
  test('speaker indicator follows this signed session, not readiness changed afterwards', () async {
    final repo=PublicRepository(),controller=realtimeControllerForTest(repo,Capture());
    try {
      expect(controller.publicSpeakerEnabled,isNull);
      await controller.start();expect(controller.publicSpeakerEnabled,isFalse);
      repo.speakerProfile='sortformer_v2_1_fastest';
      expect(controller.publicSpeakerEnabled,isFalse);
      await controller.stop();await controller.start();
      expect(controller.publicSpeakerEnabled,isTrue);
    } finally { await controller.disposeAsync(); }
  });
  test('public capture uses the declared 16k rate without changing the private default', () async {
    final repo = PublicRepository()..captureSampleRate = 16000, capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    expect(capture.startedConfigs.single.sampleRate, 16000);
  });
  test('public JSON requires an explicit supported capture rate', () {
    final json = <String, Object?>{'deploymentId': 'public', 'ownerId': 'owner',
      'processing': {'contractVersion': 1, 'processingMode': 'online', 'modelPolicyRevision': 'p'}};
    for (final value in <Object?>[null, 8000, 16000.0, '16000']) {
      expect(() => ResultSyncBinding.fromJson({...json, 'captureSampleRate': value}), throwsFormatException);
    }
    for (final value in [16000, 24000]) {
      expect(ResultSyncBinding.fromJson({...json, 'captureSampleRate': value}).captureSampleRate, value);
    }
  });
  test(
      'public capture enables endpointing and sends the marked frame before its boundary',
      () async {
    final repo = PublicRepository(), capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    expect(capture.startedConfigs.single.publicEndpointing, isTrue);
    expect(capture.startedConfigs.single.endpointOptions.keys,
        contains('vadThreshold'));
    const diagnostic = bool.fromEnvironment('ENABLE_ONLINE_EVIDENCE_TRACE');
    expect(capture.startedConfigs.single.endpointOptions['diagnosticCaptureEnabled'], diagnostic ? true : null);
    expect(capture.startedConfigs.single.endpointOptions['diagnosticSessionId'], diagnostic ? 'sess_1' : null);
    capture.emit(1, endpoint: true);
    capture.emit(2);
    await pumpEventQueue();
    expect(repo.order, ['frame:1', 'boundary', 'frame:2']);
  });
  test('private capture retains old path and never sends endpoint control',
      () async {
    final repo = PublicRepository()..public = false, capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    expect(capture.startedConfigs.single.publicEndpointing, isFalse);
    expect(capture.startedConfigs.single.endpointOptions.containsKey('diagnosticCaptureEnabled'), isFalse);
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    expect(repo.order, ['frame:1']);
  });
  test('rejected endpoint fails closed without automatic retry', () async {
    final repo = PublicRepository()..boundaryAccepted = false,
        capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    expect(controller.status.name, 'failed');
    expect(repo.order.where((s) => s == 'boundary'), hasLength(1));
  });
  test(
      'stop forwards drained audio but leaves commit to the original end protocol',
      () async {
    final repo = PublicRepository(), capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    capture.tail = true;
    await controller.stop();
    expect(repo.order, ['frame:99']);
  });
  test(
      'late endpoint rejection after stopping does not change the terminal state',
      () async {
    final repo = PublicRepository()..boundary = Completer<bool>(),
        capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    await controller.stop();
    repo.boundary!.complete(false);
    await pumpEventQueue();
    expect(controller.status.name, 'ended');
  });
  test('public playback VAD keeps PCM and commits the barge-in boundary once',
      () async {
    var now = DateTime.utc(2026, 9, 9);
    final speechGate = SpeechCaptureGate(now: () => now);
    final repo = PublicRepository(), capture = Capture();
    final controller =
        realtimeControllerForTest(repo, capture, speechCaptureGate: speechGate);
    addTearDown(controller.disposeAsync);
    await controller.start();
    speechGate.beginPlayback(text: 'voice', language: 'en');
    capture.emit(1, speechStart: true);
    await pumpEventQueue();
    expect(repo.order, ['frame:1']);
    expect(speechGate.playbackActive, isFalse);
    speechGate.endPlayback();
    now = now.add(const Duration(seconds: 1));
    capture.emit(2, endpoint:true);
    await pumpEventQueue();
    expect(repo.order, ['frame:1', 'frame:2', 'boundary']);
  });
  test('Bluetooth speech interrupts public playback without treating it as speaker echo',
      () async {
    final speechGate = SpeechCaptureGate()
      ..updateRoute(AudioOutputRoute.bluetooth);
    final repo = PublicRepository(), capture = Capture();
    final controller =
        realtimeControllerForTest(repo, capture, speechCaptureGate: speechGate);
    addTearDown(controller.disposeAsync);
    await controller.start();
    speechGate.beginPlayback(text: 'voice', language: 'en');
    expect(speechGate.playbackActive, isFalse);
    expect(speechGate.isPlaying, isTrue);
    capture.emit(1, speechStart: true);
    await pumpEventQueue();
    expect(repo.order, ['frame:1']);
    expect(speechGate.isPlaying, isFalse);
  });
}
