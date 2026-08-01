import 'dart:async';
import 'dart:typed_data';

import 'package:record/record.dart';

import 'audio_capture.dart';
import 'audio_frame.dart';

class RecordAudioCapture implements AudioCapture {
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
    _config = config;
    final stream = await _activeRecorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: config.sampleRate,
        numChannels: 1,
        echoCancel: config.echoCancel,
        noiseSuppress: config.noiseSuppress,
        streamBufferSize: _byteLength(config),
      ),
    );
    _subscription = stream.listen(
      _emitFrame,
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
    await _subscription?.cancel();
    _subscription = null;
    final recorder = _recorder;
    if (recorder != null && await recorder.isRecording()) {
      await recorder.stop();
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
    _frames.add(
      AudioFrame(
        sequence: _sequence++,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
        sampleRate: _config.sampleRate,
        bytes: bytes.toList(growable: false),
      ),
    );
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
