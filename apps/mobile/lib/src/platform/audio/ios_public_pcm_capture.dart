import 'dart:async';
import 'package:flutter/services.dart';
import 'audio_capture.dart';

bool usesIosPublicPlaybackCapture(
        AudioCaptureConfig config, TargetPlatform platform) =>
    platform == TargetPlatform.iOS &&
    config.publicEndpointing &&
    config.publicPlaybackReference;

/// PCM transport only. Reuses the original native input/converter, no ASR,
/// permission bypass, extra microphone, VAD policy or model dependency.
class IosPublicPcmCapture {
  static const _channel =
      MethodChannel('translation_mobile/public_pcm_capture');
  static const _events =
      EventChannel('translation_mobile/public_pcm_capture/events');
  StreamSubscription<dynamic>? _subscription;
  String? _captureId;
  int _generation = 0;
  Completer<void>? _stopped;
  Future<void>? _stopFuture;
  bool _streamEnded = false;

  Future<void> start(AudioCaptureConfig config, void Function(Uint8List) onData,
      void Function(Object) onError) async {
    await stop();
    final id = 'pcm-${DateTime.now().microsecondsSinceEpoch}-${++_generation}';
    _captureId = id;
    _streamEnded = false;
    final listening = Completer<void>();
    final pendingFrames = <Uint8List>[];
    var pendingBytes = 0, deliveryOpen = false;
    void deliverPending() {
      deliveryOpen = true;
      for (final bytes in pendingFrames) { onData(bytes); }
      pendingFrames.clear();pendingBytes = 0;
    }
    _subscription =
        _events.receiveBroadcastStream({'captureId': id}).listen((event) {
      if (_captureId != id || event is! Map || event['captureId'] != id) return;
      if (event['stopped'] == true) {
        if (!deliveryOpen) deliverPending();
        _streamEnded = true;
        if (_stopped case final stopped? when !stopped.isCompleted) {
          stopped.complete();
        }
        return;
      }
      if (_streamEnded) return;
      if (event['ready'] == true) {
        if (!listening.isCompleted) listening.complete();
        return;
      }
      final data = event['data'];
      if (data is Uint8List && data.isNotEmpty && data.length.isEven) {
        if (deliveryOpen) { onData(data); }
        else if (pendingBytes + data.length <= config.sampleRate * 4) {
          pendingFrames.add(Uint8List.fromList(data));pendingBytes += data.length;
        } else { onError(StateError('Native public PCM startup queue overflow')); }
      } else {
        onError(StateError('Invalid native public PCM frame'));
      }
    }, onError: (Object error) {
      if (_captureId != id) return;
      if (!listening.isCompleted) {
        listening.completeError(error);
      } else {
        onError(error);
      }
    });
    try {
      await listening.future.timeout(const Duration(seconds: 2));
      if (_captureId != id) throw StateError('Public PCM start cancelled');
      final ready = await _channel.invokeMapMethod<String, Object?>('start', {
        'captureId': id,
        'sampleRate': config.sampleRate,
        'frameDurationMs': config.frameDurationMs,
        if (config.endpointOptions['productSessionId'] is String)
          'productSessionId': config.endpointOptions['productSessionId'],
        if (config.endpointOptions['diagnosticCaptureEnabled'] == true)
          'diagnosticSessionId': config.endpointOptions['diagnosticSessionId'],
      });
      if (_captureId != id) throw StateError('Public PCM start cancelled');
      if (ready?['captureId'] != id ||
          ready?['sampleRate'] != config.sampleRate ||
          ready?['voiceProcessingEnabled'] != true ||
          ready?['sharedPlaybackReference'] != true || ready?['firstPcmReady'] != true) {
        final detail = ready?['readiness'];
        final reason = detail is Map ? detail['reason'] : null;
        throw StateError('Public PCM echo reference unavailable'
            '${reason is String ? ': $reason' : ''}');
      }
      // Let the original controller finish its start microtasks before the
      // first captured frames enter its active-session input path.
      Timer.run(() { if (_captureId == id && !_streamEnded) deliverPending(); });
    } catch (_) {
      if (_captureId == id) await stop();
      rethrow;
    }
  }

  Future<void> pause() => _control('pause');
  Future<void> resume() => _control('resume');
  Future<void> _control(String method) async {
    final id = _captureId;
    if (id != null) {
      await _channel.invokeMethod<void>(method, {'captureId': id});
    }
  }

  Future<void> stop() {
    if (_stopFuture case final pending?) return pending;
    final future = _stop();
    _stopFuture = future;
    return future.whenComplete(() {
      if (identical(_stopFuture, future)) _stopFuture = null;
    });
  }

  Future<void> _stop() async {
    final id = _captureId, subscription = _subscription;
    if (id == null) return;
    final stopped = Completer<void>();
    _stopped = stopped;
    try {
      await _channel.invokeMethod<void>('stop', {'captureId': id});
      // Ordered on the PCM event channel, not inferred from a method ACK.
      await stopped.future.timeout(const Duration(seconds: 2));
    } finally {
      if (_captureId == id) _captureId = null;
      _subscription = null;
      _stopped = null;
      await subscription?.cancel();
    }
  }
}
