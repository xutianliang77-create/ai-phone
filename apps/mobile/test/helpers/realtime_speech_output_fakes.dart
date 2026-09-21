part of '../realtime_controller_speech_test.dart';

AppConfig _config({bool useDeviceAsr = true}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: useDeviceAsr,
    useLocalSessions: useDeviceAsr,
    useOnDeviceTranslation: useDeviceAsr,
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    autoReverseTargetLanguage: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'en',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}

class _FakeRealtimeRepository extends RealtimeRepository {
  _FakeRealtimeRepository()
      : super(
          apiClient: _NoopRealtimeApiClient(),
          gatewayClient: _NoopRealtimeGatewayClient(),
        );

  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final sentFrameSequences = <int>[];

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    return RealtimeSession(
      sessionId: 'sess_1',
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
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {}

  @override
  void dispose() {
    unawaited(_events.close());
  }

  void emit(GatewayRealtimeEvent event) => _events.add(event);
}

class _FakeMobileAsrProvider implements MobileAsrProvider {
  final _segments = StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async => _segments.close();

  void emit(AsrTextSegment segment) => _segments.add(segment);
}

class _FakeTranslationProvider implements MobileTranslationProvider {
  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    final translated = switch (text) {
      'first' => '第一句',
      'second' => '第二句',
      _ => '你好',
    };
    return MobileTranslationResult(text: translated, provider: 'fake');
  }

  @override
  Future<void> dispose() async {}
}

class _FrameAudioCapture implements AudioCapture {
  final _frames = StreamController<AudioFrame>.broadcast();

  @override
  Stream<AudioFrame> get frames => _frames.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(AudioCaptureConfig config) async {}

  @override
  Future<void> pause() async {}

  @override
  Future<void> resume() async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async => _frames.close();

  void emitFrame(int sequence) {
    _frames.add(AudioFrame(
      sequence: sequence,
      timestampMs: sequence,
      sampleRate: 24000,
      bytes: const <int>[0, 0],
    ));
  }
}
