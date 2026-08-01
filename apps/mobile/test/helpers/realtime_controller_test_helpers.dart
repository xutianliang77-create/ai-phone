import 'dart:async';

import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/speech_capture_gate.dart';
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';
import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';

RealtimeController realtimeControllerForTest(
  FakeRealtimeRepository repository,
  FakeAudioCapture audio, {
  PcmAudioOutputPlayer? pcmAudioOutputPlayer,
  bool autoSpeakTranslation = false,
  AudioSessionCoordinator? audioSessionCoordinator,
  SpeechCaptureGate? speechCaptureGate,
  String realtimeMode = 'conversation',
}) {
  return RealtimeController(
    repository: repository,
    audioCapture: audio,
    pcmAudioOutputPlayer: pcmAudioOutputPlayer,
    autoSpeakTranslation: autoSpeakTranslation,
    audioSessionCoordinator: audioSessionCoordinator,
    speechCaptureGate: speechCaptureGate,
    config: AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: false,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
      realtimeMode: realtimeMode,
    ),
  );
}

class FakeRealtimeRepository extends RealtimeRepository {
  FakeRealtimeRepository({
    this.emitTailOnEnd = false,
    this.failEndConfirmation = false,
    this.startCompleter,
  }) : super(
          apiClient: NoopRealtimeApiClient(),
          gatewayClient: NoopRealtimeGatewayClient(),
        );

  final bool emitTailOnEnd;
  final bool failEndConfirmation;
  final Completer<RealtimeSession>? startCompleter;
  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final startedSessionIds = <String>[];
  final endedSessionIds = <String>[];
  final sentFrameSequences = <int>[];
  int closeRealtimeCalls = 0;

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    final pending = startCompleter;
    if (pending != null) {
      final session = await pending.future;
      startedSessionIds.add(session.sessionId);
      return session;
    }
    final sessionId = 'sess_${startedSessionIds.length + 1}';
    startedSessionIds.add(sessionId);
    return RealtimeSession(
      sessionId: sessionId,
      realtimeToken: 'token',
      endpoint: Uri.parse('ws://127.0.0.1/realtime'),
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      maxDurationSeconds: 60,
    );
  }

  @override
  bool sendAudio(String sessionId, AudioFrame frame) {
    sentFrameSequences.add(frame.sequence);
    return true;
  }

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    endedSessionIds.add(sessionId);
    if (!emitTailOnEnd) return;
    emit(GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: sessionId,
      segmentId: 'tail_1',
      text: 'tail audio',
    ));
    emit(GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: sessionId,
      segmentId: 'tail_1',
      text: '尾句已翻译',
      language: 'zh',
    ));
    await Future<void>.delayed(Duration.zero);
    if (failEndConfirmation) {
      throw const RealtimeFinalizationException(
        '最后一句处理未完整确认，现有原文和译文已保留',
      );
    }
  }

  @override
  Future<void> closeRealtime() async {
    closeRealtimeCalls += 1;
  }

  @override
  Future<bool> pauseAndWait(String sessionId) async => true;

  void emit(GatewayRealtimeEvent event) {
    _events.add(event);
  }

  @override
  void dispose() {
    unawaited(_events.close());
  }
}

class FakeAudioCapture implements AudioCapture {
  FakeAudioCapture({this.failStart = false, this.failStop = false});

  final _frames = StreamController<AudioFrame>.broadcast();
  final bool failStart;
  final bool failStop;
  int stopCalls = 0;
  int startCalls = 0;
  final startedConfigs = <AudioCaptureConfig>[];

  @override
  Stream<AudioFrame> get frames => _frames.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(AudioCaptureConfig config) async {
    startCalls += 1;
    startedConfigs.add(config);
    if (failStart) throw StateError('microphone start failed');
  }

  @override
  Future<void> pause() async {}

  @override
  Future<void> resume() async {}

  @override
  Future<void> stop() async {
    stopCalls += 1;
    if (failStop) throw StateError('microphone stop failed');
  }

  @override
  Future<void> dispose() async {
    await _frames.close();
  }

  void emitFrame(int sequence) {
    _frames.add(AudioFrame(
      sequence: sequence,
      timestampMs: sequence,
      sampleRate: 24000,
      bytes: const <int>[0, 0],
    ));
  }
}

class NoopRealtimeApiClient extends RealtimeApiClient {
  NoopRealtimeApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));

  @override
  void close() {}
}

class NoopRealtimeGatewayClient extends RealtimeGatewayClient {}
