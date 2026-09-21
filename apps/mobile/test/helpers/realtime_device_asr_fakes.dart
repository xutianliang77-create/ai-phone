part of '../realtime_controller_device_asr_test.dart';

RealtimeController _controller(
  _FakeRealtimeRepository repository,
  _FakeMobileAsrProvider provider, {
  bool local = true,
}) {
  return RealtimeController(
    repository: repository,
    audioCapture: _NoopAudioCapture(),
    mobileAsrProvider: provider,
    config: AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      useLocalSessions: local,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'en',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      autoReverseTargetLanguage: false,
      serverOwnedHistory: true,
    ),
  );
}

class _SentTextSegment {
  const _SentTextSegment(this.sessionId, this.segment);

  final String sessionId;
  final AsrTextSegment segment;
}

class _FakeRealtimeRepository extends RealtimeRepository {
  _FakeRealtimeRepository()
      : super(
          apiClient: _NoopRealtimeApiClient(),
          gatewayClient: _NoopRealtimeGatewayClient(),
        );

  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final startedSessionIds = <String>[];
  final pausedSessionIds = <String>[];
  final resumedSessionIds = <String>[];
  final endedSessionIds = <String>[];
  final sentTextSegments = <_SentTextSegment>[];
  int closeRealtimeCalls = 0;

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
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
  bool sendTextSegment(String sessionId, AsrTextSegment segment) {
    sentTextSegments.add(_SentTextSegment(sessionId, segment));
    return true;
  }

  @override
  bool pause(String sessionId) {
    pausedSessionIds.add(sessionId);
    return true;
  }

  @override
  Future<bool> pauseAndWait(String sessionId) async => pause(sessionId);
  @override
  bool resume(String sessionId) {
    resumedSessionIds.add(sessionId);
    return true;
  }

  @override
  Future<bool> resumeAndWait(String sessionId) async => resume(sessionId);

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async =>
      endedSessionIds.add(sessionId);

  @override
  Future<void> closeRealtime() async => closeRealtimeCalls += 1;

  @override
  void dispose() => unawaited(_events.close());
}

class _FakeMobileAsrProvider
    implements MobileAsrProvider, MobileAsrDiagnostics, MobileAsrPreparation {
  _FakeMobileAsrProvider({
    this.onStopSegment,
    this.failStart = false,
    this.failResumeStart = false,
    this.failStop = false,
  });

  final AsrTextSegment? onStopSegment;
  final bool failStart;
  final bool failResumeStart;
  final bool failStop;
  final _segments = StreamController<AsrTextSegment>.broadcast();
  final calls = <String>[];
  int startCalls = 0;
  int stopCalls = 0;

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    calls.add('availability');
    return const MobileAsrAvailability(
      canStart: true,
      reason: 'ready',
      message: 'Device ASR ready',
    );
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {
    calls.add('prepare');
  }

  @override
  Future<void> requestPermission() async {
    calls.add('requestPermission');
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    calls.add('start');
    startCalls += 1;
    if (failStart || (failResumeStart && startCalls > 1)) {
      throw StateError('device ASR start failed');
    }
  }

  @override
  Future<void> stop() async {
    calls.add('stop');
    stopCalls += 1;
    if (failStop) throw StateError('device ASR stop failed');
    final segment = onStopSegment;
    if (segment != null) {
      Timer(const Duration(milliseconds: 10), () {
        if (!_segments.isClosed) _segments.add(segment);
      });
    }
  }

  @override
  Future<void> dispose() async {
    await _segments.close();
  }

  void emit(AsrTextSegment segment) {
    _segments.add(segment);
  }
}

class _NoopAudioCapture implements AudioCapture {
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
  Future<void> dispose() async {
    await _frames.close();
  }
}

class _NoopRealtimeApiClient extends RealtimeApiClient {
  _NoopRealtimeApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));

  @override
  void close() {}
}

class _NoopRealtimeGatewayClient extends RealtimeGatewayClient {}
