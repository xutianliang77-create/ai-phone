import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../../platform/audio/audio_frame.dart';
import '../../../../platform/asr/asr_text_segment.dart';
import '../api/realtime_session.dart';
import 'gateway_realtime_event.dart';
import 'realtime_reconnect_audio_buffer.dart';
import 'realtime_reconnect_backoff.dart';
import 'realtime_gateway_transport.dart';

export 'realtime_gateway_transport.dart'
    show realtimeGatewayEndpoint, realtimeGatewayProtocols;
part 'realtime_gateway_control.dart';

class RealtimeGatewayClient {
  static const Duration _connectTimeout = Duration(seconds: 8);
  static const Duration _controlTimeout = Duration(seconds: 12);
  static const Duration _endTimeout = Duration(seconds: 12);

  RealtimeGatewayClient({
    RealtimeReconnectBackoff reconnectBackoff =
        const RealtimeReconnectBackoff(),
    double Function()? reconnectJitterUnit,
    RealtimeReconnectAudioBuffer? reconnectAudioBuffer,
  })  : _reconnectBackoff = reconnectBackoff,
        _reconnectJitterUnit = reconnectJitterUnit ?? Random().nextDouble,
        _reconnectAudioBuffer =
            reconnectAudioBuffer ?? RealtimeReconnectAudioBuffer();

  final StreamController<GatewayRealtimeEvent> _events =
      StreamController<GatewayRealtimeEvent>.broadcast();
  final RealtimeReconnectBackoff _reconnectBackoff;
  final double Function() _reconnectJitterUnit;
  final RealtimeReconnectAudioBuffer _reconnectAudioBuffer;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  Timer? _stableConnectionTimer;
  RealtimeSession? _session;
  bool _manualClose = false;
  bool _suspended = false;
  bool _transportReady = false;
  int _reconnectAttempts = 0;
  int _connectionGeneration = 0;
  RealtimeReconnectAudioDrain _lastReconnectAudioDrain =
      RealtimeReconnectAudioDrain.empty;

  Stream<GatewayRealtimeEvent> get events => _events.stream;

  Future<void> connect(RealtimeSession session) async {
    _session = session;
    _manualClose = false;
    _suspended = false;
    _reconnectAttempts = 0;
    _reconnectAudioBuffer.clear();
    _lastReconnectAudioDrain = RealtimeReconnectAudioDrain.empty;
    await _open(session);
  }

  Future<void> _open(RealtimeSession session) async {
    _transportReady = false;
    final generation = ++_connectionGeneration;
    final channel = WebSocketChannel.connect(
      realtimeGatewayEndpoint(session),
      protocols: realtimeGatewayProtocols(session),
    );
    _channel = channel;
    _subscription = channel.stream.listen(
      (message) => _handleMessage(generation, message),
      onError: (Object error) => _handleDisconnect(generation, error),
      onDone: () => _handleDisconnect(generation),
    );
    await channel.ready.timeout(_connectTimeout);
    if (generation != _connectionGeneration || !identical(_channel, channel)) {
      throw StateError('Realtime connection closed before becoming ready');
    }
    _transportReady = true;
    _lastReconnectAudioDrain = _flushReconnectAudio(session.sessionId);
    _scheduleStableConnectionReset(generation);
  }

  Future<void> suspendForLifecycle() async {
    _suspended = true;
    _reconnectTimer?.cancel();
    _reconnectAudioBuffer.clear();
    await _closeTransport();
  }

  Future<bool> reconnectAndResume(
    String sessionId, {
    Duration timeout = _controlTimeout,
  }) async {
    final session = _session;
    if (session == null || session.sessionId != sessionId) return false;
    _reconnectTimer?.cancel();
    await _closeTransport();
    _manualClose = false;
    _suspended = false;
    try {
      await _open(session);
      return await resumeAndWait(sessionId, timeout: timeout);
    } catch (_) {
      return false;
    }
  }

  bool sendAudio(String sessionId, AudioFrame frame) {
    if (!_transportReady || _channel == null) {
      if (_shouldBufferReconnectAudio(sessionId)) {
        _reconnectAudioBuffer.add(frame);
        return true;
      }
      return false;
    }
    return _sendAudioFrame(sessionId, frame);
  }

  bool _sendAudioFrame(String sessionId, AudioFrame frame) {
    return _send({
      'type': 'audio.frame',
      'sessionId': sessionId,
      'sequence': frame.sequence,
      'timestampMs': frame.timestampMs,
      'format': 'pcm16',
      'sampleRate': frame.sampleRate,
      'data': base64Encode(frame.bytes),
    });
  }

  bool sendTextSegment(
    String sessionId,
    AsrTextSegment segment, {
    String fallbackTargetLanguage = 'zh',
  }) {
    return _send({
      'type': 'client.text.segment',
      'sessionId': sessionId,
      'segmentId': segment.id,
      'text': segment.text,
      'language': normalizeAsrLanguageForGateway(
        segment.language,
        fallbackTargetLanguage: fallbackTargetLanguage,
      ),
      'isFinal': segment.isFinal,
      if (segment.confidence != null) 'confidence': segment.confidence,
    });
  }

  bool pause(String sessionId) {
    return _send({'type': 'session.pause', 'sessionId': sessionId});
  }

  Future<bool> pauseAndWait(
    String sessionId, {
    Duration timeout = _controlTimeout,
  }) {
    final completed = _waitForSessionEvent(
      'session.paused',
      sessionId,
      timeout,
    );
    if (!pause(sessionId)) return Future<bool>.value(false);
    return completed;
  }

  bool resume(String sessionId) {
    return _send({'type': 'session.resume', 'sessionId': sessionId});
  }

  Future<bool> resumeAndWait(
    String sessionId, {
    Duration timeout = _controlTimeout,
  }) {
    final completed = _waitForSessionEvent(
      'session.resumed',
      sessionId,
      timeout,
    );
    if (!resume(sessionId)) return Future<bool>.value(false);
    return completed;
  }

  Future<void> setVoiceOutput(String sessionId, bool enabled,
          {String? presetId}) =>
      _setVoiceOutput(sessionId, enabled, presetId: presetId);

  bool end(String sessionId) {
    _manualClose = true;
    _reconnectTimer?.cancel();
    _stableConnectionTimer?.cancel();
    _reconnectAudioBuffer.clear();
    return _send({'type': 'session.end', 'sessionId': sessionId});
  }

  Future<bool> endAndWait(
    String sessionId, {
    Duration timeout = _endTimeout,
  }) {
    final completed = events
        .firstWhere((event) =>
            event.type == 'session.ended' && event.sessionId == sessionId)
        .timeout(timeout)
        .then((event) => event.flush?.isSuccessful == true)
        .catchError((Object _) => false);
    if (!end(sessionId)) return Future<bool>.value(false);
    return completed;
  }

  Future<void> close() async {
    _manualClose = true;
    _suspended = false;
    _reconnectTimer?.cancel();
    _stableConnectionTimer?.cancel();
    _reconnectAudioBuffer.clear();
    await _closeTransport();
  }

  void dispose() {
    unawaited(close());
    unawaited(_events.close());
  }

  bool _send(Map<String, Object?> payload) {
    final channel = _channel;
    if (channel == null) return false;
    channel.sink.add(jsonEncode(payload));
    return true;
  }

  void _handleMessage(int generation, dynamic message) {
    if (generation != _connectionGeneration) return;
    if (message is! String) return;
    final json = jsonDecode(message) as Map<String, Object?>;
    final event = GatewayRealtimeEvent.fromJson(json);
    if (event.type == 'session.ended') {
      _manualClose = true;
      _reconnectTimer?.cancel();
      _stableConnectionTimer?.cancel();
      _reconnectAudioBuffer.clear();
    }
    _events.add(event);
  }

  void _handleDisconnect(int generation, [Object? error]) {
    if (generation != _connectionGeneration) return;
    final subscription = _subscription;
    final channel = _channel;
    _transportReady = false;
    _channel = null;
    _subscription = null;
    unawaited(subscription?.cancel());
    unawaited(channel?.sink.close());
    _stableConnectionTimer?.cancel();
    if (_manualClose || _suspended) return;
    if (_reconnectTimer?.isActive ?? false) return;
    if (_reconnectAttempts >= _reconnectBackoff.maxAttempts) {
      _events.add(const GatewayRealtimeEvent.connection(
        type: 'connection.closed',
        message: 'Realtime connection lost',
      ));
      return;
    }

    _reconnectAttempts += 1;
    _events.add(GatewayRealtimeEvent.connection(
      type: 'connection.reconnecting',
      message:
          'Reconnecting ($_reconnectAttempts/${_reconnectBackoff.maxAttempts})',
    ));
    _reconnectTimer?.cancel();
    final delay = _reconnectBackoff.delayForAttempt(
      _reconnectAttempts,
      jitterUnit: _reconnectJitterUnit(),
    );
    _reconnectTimer = Timer(delay, () async {
      final session = _session;
      if (session == null || _manualClose || _suspended) return;
      try {
        await _open(session);
        _events.add(GatewayRealtimeEvent.connection(
          type: 'connection.reconnected',
          message: 'Realtime connection restored',
          replayedAudioMs: _lastReconnectAudioDrain.replayedAudioMs,
          droppedAudioMs: _lastReconnectAudioDrain.droppedAudioMs,
        ));
      } catch (_) {
        _handleDisconnect(_connectionGeneration);
      }
    });
  }

  void _scheduleStableConnectionReset(int generation) {
    _stableConnectionTimer?.cancel();
    _stableConnectionTimer = Timer(
      _reconnectBackoff.stableConnectionPeriod,
      () {
        if (generation != _connectionGeneration ||
            _channel == null ||
            _manualClose ||
            _suspended) {
          return;
        }
        _reconnectAttempts = 0;
      },
    );
  }

  Future<void> _closeTransport() async {
    _connectionGeneration += 1;
    _stableConnectionTimer?.cancel();
    _transportReady = false;
    final subscription = _subscription;
    final channel = _channel;
    _subscription = null;
    _channel = null;
    await subscription?.cancel();
    await channel?.sink.close();
  }

  bool _shouldBufferReconnectAudio(String sessionId) {
    return _reconnectAttempts > 0 &&
        _session?.sessionId == sessionId &&
        !_manualClose &&
        !_suspended;
  }

  RealtimeReconnectAudioDrain _flushReconnectAudio(String sessionId) {
    final drain = _reconnectAudioBuffer.drain();
    for (final frame in drain.frames) {
      _sendAudioFrame(sessionId, frame);
    }
    return drain;
  }
}
