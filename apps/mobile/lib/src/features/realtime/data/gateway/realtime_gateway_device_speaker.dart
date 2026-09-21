part of 'realtime_gateway_client.dart';

class _DeviceSpeakerState {
  String? sessionId;
  int samples = 0, sequence = 0, through = 0;
  StreamSubscription<Map<String, Object?>>? subscription;
}

extension RealtimeGatewayDeviceSpeaker on RealtimeGatewayClient {
  Future<bool> prepareDeviceSpeaker() async =>
      await deviceSpeaker?.prepare() ?? false;

  Future<void> _startDeviceSpeaker(RealtimeSession session) async {
    _speaker.samples = 0;
    _speaker.sequence = 0;
    _speaker.through = 0;
    if (session.deviceSpeakerProfile != deviceSpeakerProfile) return;
    final generation = _connectionGeneration;
    _speaker.sessionId = session.sessionId;
    try {
      if (deviceSpeaker == null) throw StateError('device_speaker_missing');
      _speaker.subscription = deviceSpeaker!.events.listen((event) {
        if (_connectionGeneration != generation) return;
        if (event['type'] == 'speaker.unavailable') {
          if (event['sessionId'] == _speaker.sessionId) _speakerUnavailable();
        } else {
          _sendSpeakerEvidence(event);
        }
      }, onError: (Object _) { if (_connectionGeneration == generation) _speakerUnavailable(); });
      await deviceSpeaker!.start(session.sessionId, session.syncBinding!.captureSampleRate);
      if (generation != _connectionGeneration) await _cancelDeviceSpeaker();
    } catch (_) { _speakerUnavailable(); }
  }

  void _acceptSpeakerAudio(String sessionId, AudioFrame frame) {
    if (_speaker.sessionId != sessionId) return;
    final start = _speaker.samples, generation = _connectionGeneration;
    _speaker.samples += frame.bytes.length ~/ 2;
    // Native serial queue is bounded; never await inference in audio upload.
    unawaited(deviceSpeaker!.accept(sessionId, start, frame.bytes).catchError((Object _) {
      if (generation == _connectionGeneration && _speaker.sessionId == sessionId) _speakerUnavailable();
    }));
  }

  void _sendSpeakerEvidence(Map<String, Object?> event) {
    final id = _speaker.sessionId;
    final sequence = event['sequence'], through = event['throughSample'];
    if (id == null || _session?.sessionId != id || !_transportReady || _manualClose ||
        event['sessionId'] != id || event['type'] != 'speaker.evidence' ||
        event['profile'] != deviceSpeakerProfile || event['modelRevision'] != deviceSpeakerRevision ||
        event['sampleRate'] != _session?.syncBinding?.captureSampleRate ||
        sequence is! int || sequence <= _speaker.sequence || through is! int ||
        through <= _speaker.through || through > _speaker.samples || event['spans'] is! List) { return; }
    if (_send(event)) { _speaker.sequence = sequence; _speaker.through = through; }
  }

  Future<void> _finishDeviceSpeaker(String sessionId) async {
    if (_speaker.sessionId != sessionId) return;
    try {
      final results = await deviceSpeaker!.finish(sessionId).timeout(const Duration(seconds: 3));
      for (final result in results) { _sendSpeakerEvidence(result); }
    } catch (_) { _speakerUnavailable(); }
    await _cancelDeviceSpeaker();
  }

  void _speakerUnavailable() {
    final id = _speaker.sessionId;
    if (id == null) return;
    _events.add(GatewayRealtimeEvent(type: 'speaker.unavailable', sessionId: id,
        message: '手机说话人识别暂不可用，原文、翻译与朗读继续；缺少证据的片段不标记说话人。'));
    unawaited(_cancelDeviceSpeaker());
  }

  Future<void> _cancelDeviceSpeaker() async {
    final id = _speaker.sessionId, subscription = _speaker.subscription;
    _speaker.sessionId = null; _speaker.subscription = null;
    await subscription?.cancel();
    if (id != null) {
      try { await deviceSpeaker?.cancel(id).timeout(const Duration(seconds: 1)); } catch (_) { /* advisory */ }
    }
  }
}
