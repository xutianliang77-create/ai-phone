import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../../platform/audio/audio_frame.dart';
import '../../../../platform/asr/asr_text_segment.dart';
import '../api/realtime_session.dart';
import 'gateway_realtime_event.dart';

class RealtimeGatewayClient {
  static const int _maxReconnectAttempts = 3;
  static const Duration _connectTimeout = Duration(seconds: 8);
  static const Duration _controlTimeout = Duration(seconds: 12);
  static const Duration _endTimeout = Duration(seconds: 12);

  final StreamController<GatewayRealtimeEvent> _events =
      StreamController<GatewayRealtimeEvent>.broadcast();
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  RealtimeSession? _session;
  bool _manualClose = false;
  bool _suspended = false;
  int _reconnectAttempts = 0;
  int _connectionGeneration = 0;

  Stream<GatewayRealtimeEvent> get events => _events.stream;

  Future<void> connect(RealtimeSession session) async {
    _session = session;
    _manualClose = false;
    _suspended = false;
    _reconnectAttempts = 0;
    await _open(session);
  }

  Future<void> _open(RealtimeSession session) async {
    final generation = ++_connectionGeneration;
    final endpoint = session.endpoint.replace(
      queryParameters: <String, String>{
        ...session.endpoint.queryParameters,
        'token': session.realtimeToken,
      },
    );
    final channel = WebSocketChannel.connect(endpoint);
    _channel = channel;
    _subscription = channel.stream.listen(
      _handleMessage,
      onError: (Object error) => _handleDisconnect(generation, error),
      onDone: () => _handleDisconnect(generation),
    );
    await channel.ready.timeout(_connectTimeout);
  }

  Future<void> suspendForLifecycle() async {
    _suspended = true;
    _reconnectTimer?.cancel();
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
      _reconnectAttempts = 0;
      return await resumeAndWait(sessionId, timeout: timeout);
    } catch (_) {
      return false;
    }
  }

  bool sendAudio(String sessionId, AudioFrame frame) {
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

  bool end(String sessionId) {
    _manualClose = true;
    _reconnectTimer?.cancel();
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

  Future<bool> _waitForSessionEvent(
    String type,
    String sessionId,
    Duration timeout,
  ) {
    return events
        .firstWhere(
          (event) =>
              event.type == type &&
              (event.sessionId == null || event.sessionId == sessionId),
        )
        .timeout(timeout)
        .then((_) => true)
        .catchError((Object _) => false);
  }

  Future<void> close() async {
    _manualClose = true;
    _suspended = false;
    _reconnectTimer?.cancel();
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

  void _handleMessage(dynamic message) {
    if (message is! String) return;
    final json = jsonDecode(message) as Map<String, Object?>;
    final event = GatewayRealtimeEvent.fromJson(json);
    if (event.type == 'session.ended') {
      _manualClose = true;
      _reconnectTimer?.cancel();
    }
    _events.add(event);
  }

  void _handleDisconnect(int generation, [Object? error]) {
    if (generation != _connectionGeneration) return;
    _channel = null;
    if (_manualClose || _suspended) return;
    if (_reconnectTimer?.isActive ?? false) return;
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      _events.add(const GatewayRealtimeEvent.connection(
        type: 'connection.closed',
        message: 'Realtime connection lost',
      ));
      return;
    }

    _reconnectAttempts += 1;
    _events.add(GatewayRealtimeEvent.connection(
      type: 'connection.reconnecting',
      message: 'Reconnecting ($_reconnectAttempts/$_maxReconnectAttempts)',
    ));
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: _reconnectAttempts), () async {
      final session = _session;
      if (session == null || _manualClose) return;
      try {
        await _subscription?.cancel();
        await _open(session);
        _reconnectAttempts = 0;
        _events.add(const GatewayRealtimeEvent.connection(
          type: 'connection.reconnected',
          message: 'Realtime connection restored',
        ));
      } catch (_) {
        _handleDisconnect(_connectionGeneration);
      }
    });
  }

  Future<void> _closeTransport() async {
    _connectionGeneration += 1;
    final subscription = _subscription;
    final channel = _channel;
    _subscription = null;
    _channel = null;
    await subscription?.cancel();
    await channel?.sink.close();
  }
}
