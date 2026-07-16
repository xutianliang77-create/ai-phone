import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/speech_capture_gate.dart';
import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';

void main() {
  test('blocks speaker capture for playback and a short echo tail', () {
    var now = DateTime(2026);
    final gate = SpeechCaptureGate(now: () => now);

    gate.beginPlayback();
    now = now.add(const Duration(seconds: 10));
    expect(gate.blocksCapture, isTrue);

    gate.endPlayback();
    now = now.add(const Duration(milliseconds: 349));
    expect(gate.blocksCapture, isTrue);
    now = now.add(const Duration(milliseconds: 2));
    expect(gate.blocksCapture, isFalse);
  });

  test('keeps capture open for wired and Bluetooth headsets', () {
    final gate = SpeechCaptureGate();

    for (final route in <AudioOutputRoute>[
      AudioOutputRoute.headphones,
      AudioOutputRoute.bluetooth,
    ]) {
      gate.updateRoute(route);
      gate.beginPlayback();
      expect(gate.blocksCapture, isFalse);
      gate.endPlayback();
      expect(gate.blocksCapture, isFalse);
    }
  });

  test('applies suppression immediately when playback moves to speaker', () {
    final gate = SpeechCaptureGate();
    gate.updateRoute(AudioOutputRoute.headphones);
    gate.beginPlayback();
    expect(gate.blocksCapture, isFalse);

    gate.updateRoute(AudioOutputRoute.speaker);
    expect(gate.blocksCapture, isTrue);
    gate.reset();
    expect(gate.blocksCapture, isFalse);
  });

  test('drops matching speaker echo but allows opposite-language barge-in', () {
    final gate = SpeechCaptureGate();

    gate.beginPlayback(text: 'Hello, where are you?', language: 'en');

    expect(
      gate.shouldDropDeviceAsr(text: 'hello where are you', language: 'en'),
      isTrue,
    );
    expect(
      gate.shouldDropDeviceAsr(text: '你好，我在这里', language: 'zh'),
      isFalse,
    );
  });

  test('echo tail only drops similar text after playback completes', () {
    var now = DateTime(2026);
    final gate = SpeechCaptureGate(now: () => now);
    gate.beginPlayback(text: 'It has been posted here', language: 'en');
    gate.endPlayback();

    expect(
      gate.shouldDropDeviceAsr(
        text: 'It has been posted here a seven',
        language: 'en',
      ),
      isTrue,
    );
    expect(
      gate.shouldDropDeviceAsr(text: 'Where are you going', language: 'en'),
      isFalse,
    );
    now = now.add(const Duration(milliseconds: 351));
    expect(
      gate.shouldDropDeviceAsr(
        text: 'It has been posted here',
        language: 'en',
      ),
      isFalse,
    );
  });
}
