import 'dart:async';
import 'dart:typed_data';

import 'package:record/record.dart';

import 'audio_capture.dart';
import 'audio_frame.dart';
import 'online_audio_endpoint.dart';

class RecordAudioCapture implements AudioCapture {
  RecordAudioCapture({AudioEndpointDetector? endpointDetector})
      : _endpointDetector = endpointDetector ?? IosAudioEndpointDetector();
  final AudioEndpointDetector _endpointDetector;
  OnlineAudioEndpointProcessor? _endpoint;
  int _generation = 0;
  final StreamController<AudioFrame> _frames =
      StreamController<AudioFrame>.broadcast();
  AudioRecorder? _recorder;
  StreamSubscription<Uint8List>? _subscription;
  int _sequence = 1;
  AudioCaptureConfig _config = const AudioCaptureConfig();

  @override
  Stream<AudioFrame> get frames => _frames.stream;

  @override
  Future<void> requestPermission() async {
    final hasPermission = await _activeRecorder.hasPermission();
    if (!hasPermission) {
      throw const AudioCaptureException('Microphone permission was denied');
    }
  }

  @override
  Future<void> start(AudioCaptureConfig config) async {
    await stop();
    final generation = ++_generation;
    _config = config;
    if (config.publicEndpointing) {
      final endpoint = OnlineAudioEndpointProcessor(
          _endpointDetector, _frames.add, _frames.addError);
      _endpoint = endpoint;
      await endpoint.start(config.sampleRate, options: config.endpointOptions);
      if (generation != _generation) {
        throw const AudioCaptureException('音频启动已取消');
      }
    }
    final recorder = _activeRecorder;
    await recorder.ios?.manageAudioSession(config.managePlatformAudioSession);
    if (generation != _generation) throw const AudioCaptureException('音频启动已取消');
    final stream = await recorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: config.sampleRate,
        numChannels: 1,
        echoCancel: config.echoCancel,
        noiseSuppress: config.noiseSuppress,
        streamBufferSize: _byteLength(config),
      ),
    );
    if (generation != _generation) {
      await recorder.stop();
      throw const AudioCaptureException('音频启动已取消');
    }
    _subscription = stream.listen(
      (bytes) {
        if (generation == _generation) _emitFrame(bytes);
      },
      onError: _frames.addError,
    );
  }

  @override
  Future<void> pause() async {
    await _recorder?.pause();
  }

  @override
  Future<void> resume() async {
    await _recorder?.resume();
  }

  @override
  Future<void> stop() async {
    _generation++;
    final subscription = _subscription;
    _subscription = null;
    final recorder = _recorder;
    final endpoint = _endpoint;
    try {
      await subscription?.cancel();
      if (recorder != null && await recorder.isRecording()) {
        await recorder.stop();
      }
    } finally {
      if (identical(_endpoint, endpoint)) _endpoint = null;
      if (endpoint != null) {
        await endpoint.stop();
        await Future<void>.delayed(Duration.zero);
      }
    }
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _recorder?.dispose();
    _recorder = null;
    await _frames.close();
  }

  AudioRecorder get _activeRecorder {
    return _recorder ??= AudioRecorder();
  }

  void _emitFrame(Uint8List bytes) {
    if (bytes.isEmpty) return;
    final frame = AudioFrame(
      sequence: _sequence++,
      timestampMs: DateTime.now().millisecondsSinceEpoch,
      sampleRate: _config.sampleRate,
      bytes: bytes.toList(growable: false),
    );
    final endpoint = _endpoint;
    if (endpoint != null) {
      endpoint.add(frame);
    } else {
      _frames.add(frame);
    }
  }

  int _byteLength(AudioCaptureConfig config) {
    return config.sampleRate * config.frameDurationMs ~/ 500;
  }
}

class AudioCaptureException implements Exception {
  const AudioCaptureException(this.message);

  final String message;

  @override
  String toString() => message;
}
