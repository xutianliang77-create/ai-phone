import 'dart:async';

import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';

class FakeAudioSessionCoordinator implements AudioSessionCoordinator {
  final _events = StreamController<AudioSessionEvent>.broadcast();
  int beginCaptureCalls = 0;
  int endCaptureCalls = 0;
  final voiceProcessingValues = <bool>[];

  @override
  Stream<AudioSessionEvent> get events => _events.stream;

  void emit(AudioSessionEvent event) => _events.add(event);

  @override
  Future<void> beginCapture({bool voiceProcessing = true}) async {
    beginCaptureCalls += 1;
    voiceProcessingValues.add(voiceProcessing);
  }

  @override
  Future<void> endCapture() async {
    endCaptureCalls += 1;
  }

  @override
  Future<void> dispose() => _events.close();
}
