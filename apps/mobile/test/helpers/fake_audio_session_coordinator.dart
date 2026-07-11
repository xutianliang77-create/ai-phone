import 'dart:async';

import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';

class FakeAudioSessionCoordinator implements AudioSessionCoordinator {
  final _events = StreamController<AudioSessionEvent>.broadcast();
  int beginCaptureCalls = 0;
  int endCaptureCalls = 0;

  @override
  Stream<AudioSessionEvent> get events => _events.stream;

  void emit(AudioSessionEvent event) => _events.add(event);

  @override
  Future<void> beginCapture() async {
    beginCaptureCalls += 1;
  }

  @override
  Future<void> endCapture() async {
    endCaptureCalls += 1;
  }

  @override
  Future<void> dispose() => _events.close();
}
