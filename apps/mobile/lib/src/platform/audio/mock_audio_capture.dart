import 'dart:async';

import 'audio_capture.dart';
import 'audio_frame.dart';

class MockAudioCapture implements AudioCapture {
  final StreamController<AudioFrame> _controller = StreamController.broadcast();
  Timer? _timer;
  int _sequence = 0;

  @override
  Stream<AudioFrame> get frames => _controller.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(AudioCaptureConfig config) async {
    _timer?.cancel();
    final byteLength = config.sampleRate * config.frameDurationMs ~/ 500;
    _timer =
        Timer.periodic(Duration(milliseconds: config.frameDurationMs), (_) {
      _controller.add(
        AudioFrame(
          sequence: _sequence++,
          timestampMs: DateTime.now().millisecondsSinceEpoch,
          sampleRate: config.sampleRate,
          bytes: List<int>.filled(byteLength, 0),
        ),
      );
    });
  }

  @override
  Future<void> pause() async {
    _timer?.cancel();
  }

  @override
  Future<void> resume() async {
    await start(const AudioCaptureConfig());
  }

  @override
  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _controller.close();
  }
}
