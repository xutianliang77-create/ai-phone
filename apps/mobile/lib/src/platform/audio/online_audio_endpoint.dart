import 'dart:async';
import 'package:flutter/services.dart';
import 'audio_frame.dart';

abstract interface class AudioEndpointDetector {
  Future<void> start(int sampleRate, {Map<String, Object?> options = const {}});
  Future<bool> accept(AudioFrame frame);
  Future<void> stop();
}

class IosAudioEndpointDetector implements AudioEndpointDetector {
  static const _channel = MethodChannel('translation_mobile/apple_speech_asr');
  static int _counter = 0;
  String? _id;
  int _sampleRate = 0;
  @override
  Future<void> start(int sampleRate,
      {Map<String, Object?> options = const {}}) async {
    await stop();
    final id =
        'endpoint-${DateTime.now().microsecondsSinceEpoch}-${++_counter}';
    _id = id;
    _sampleRate = sampleRate;
    try {
      final value = await _channel.invokeMapMethod<String, Object?>(
          'endpoint.start', {
        ...options,
        'requestId': id,
        'sampleRate': sampleRate
      }).timeout(const Duration(seconds: 5));
      if (_id != id ||
          value?['requestId'] != id ||
          value?['ready'] != true ||
          value?['provider'] != 'fluidaudio_silero') {
        throw StateError('手机端点资源未确认');
      }
    } catch (_) {
      if (_id == id) _id = null;
      unawaited(_channel.invokeMethod<void>(
          'endpoint.stop', {'requestId': id}).catchError((Object _) {}));
      rethrow;
    }
  }

  @override
  Future<bool> accept(AudioFrame frame) async {
    final id = _id;
    if (id == null ||
        frame.sampleRate != _sampleRate ||
        frame.sequence < 0 ||
        frame.bytes.isEmpty ||
        frame.bytes.length.isOdd ||
        frame.bytes.length > _sampleRate * 2 ||
        frame.bytes.any((v) => v < 0 || v > 255)) {
      throw StateError('手机端点音频无效');
    }
    final value =
        await _channel.invokeMapMethod<String, Object?>('endpoint.process', {
      'requestId': id,
      'sequence': frame.sequence,
      'pcm': Uint8List.fromList(frame.bytes)
    }).timeout(const Duration(seconds: 2));
    if (_id != id ||
        value?['requestId'] != id ||
        value?['sequence'] != frame.sequence ||
        value?['boundary'] is! bool) {
      throw StateError('手机端点回执不匹配');
    }
    return value!['boundary']! as bool;
  }

  @override
  Future<void> stop() async {
    final id = _id;
    _id = null;
    if (id != null) {
      await _channel.invokeMethod<void>('endpoint.stop',
          {'requestId': id}).timeout(const Duration(seconds: 2));
    }
  }
}

/// Ordered side-analysis of the ONE capture stream. Never crops/resamples upload PCM.
class OnlineAudioEndpointProcessor {
  OnlineAudioEndpointProcessor(this.detector, this.emit, this.onError);
  final AudioEndpointDetector detector;
  final void Function(AudioFrame) emit;
  final void Function(Object) onError;
  Future<void> _chain = Future<void>.value();
  int _epoch = 0, _queuedSamples = 0, _turnSamples = 0, _rate = 0;
  bool _accepting = false, _open = false;
  Object? _failure;
  Future<void>? _stopping;
  Future<void> start(int rate,
      {Map<String, Object?> options = const {}}) async {
    final epoch = ++_epoch;
    _rate = rate;
    _open = true;
    await detector.start(rate, options: options);
    if (!_open || epoch != _epoch) throw StateError('手机端点准备已取消');
    _accepting = true;
  }

  void add(AudioFrame frame) {
    if (!_accepting || _failure != null) return;
    final samples = frame.bytes.length ~/ 2;
    if (frame.sampleRate != _rate ||
        frame.bytes.length.isOdd ||
        samples == 0 ||
        samples > _rate ||
        _queuedSamples + samples > _rate * 2) {
      _fail(StateError('手机端点队列溢出或音频格式不匹配'));
      return;
    }
    final epoch = _epoch,
        copy = AudioFrame(
            sequence: frame.sequence,
            timestampMs: frame.timestampMs,
            sampleRate: frame.sampleRate,
            bytes: List<int>.unmodifiable(frame.bytes));
    _queuedSamples += samples;
    _chain = _chain.then((_) async {
      if (!_open || epoch != _epoch || _failure != null) return;
      final vadEnd = await detector.accept(copy);
      if (!_open || epoch != _epoch || _failure != null) return;
      _turnSamples += samples;
      // Leave margin below Gateway's 30-second turn cap (capture packet <=1s).
      final boundary = vadEnd || _turnSamples >= _rate * 28;
      if (boundary) _turnSamples = 0;
      emit(AudioFrame(
          sequence: copy.sequence,
          timestampMs: copy.timestampMs,
          sampleRate: copy.sampleRate,
          bytes: copy.bytes,
          endsSegment: boundary));
    }).catchError((Object error) {
      if (epoch == _epoch && _open) _fail(error);
    }).whenComplete(() {
      if (epoch == _epoch) _queuedSamples -= samples;
    });
  }

  void _fail(Object error) {
    if (_failure != null) return;
    _failure = error;
    _accepting = false;
    onError(error);
  }

  Future<void> stop({bool drain = true}) => _stopping ??= _stop(drain);
  Future<void> _stop(bool drain) async {
    _accepting = false;
    try {
      if (drain) await _chain.timeout(const Duration(seconds: 3));
      if (_failure != null) throw _failure!;
    } finally {
      _open = false;
      _epoch++;
      _queuedSamples = 0;
      await detector.stop();
    }
  }
}
