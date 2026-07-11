import 'audio_frame.dart';

abstract interface class AudioCapture {
  Stream<AudioFrame> get frames;

  Future<void> requestPermission();
  Future<void> start(AudioCaptureConfig config);
  Future<void> pause();
  Future<void> resume();
  Future<void> stop();
  Future<void> dispose();
}

class AudioCaptureConfig {
  const AudioCaptureConfig({
    this.sampleRate = 24000,
    this.frameDurationMs = 40,
  });

  final int sampleRate;
  final int frameDurationMs;
}
