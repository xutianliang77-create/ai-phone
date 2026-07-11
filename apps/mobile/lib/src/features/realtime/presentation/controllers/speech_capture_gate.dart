import '../../../../platform/audio/audio_session_coordinator.dart';

class SpeechCaptureGate {
  SpeechCaptureGate({
    this.cooldown = const Duration(milliseconds: 350),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Duration cooldown;
  final DateTime Function() _now;
  AudioOutputRoute _route = AudioOutputRoute.speaker;
  bool _playbackActive = false;
  DateTime _cooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);

  bool get blocksCapture {
    if (!_route.requiresAcousticEchoSuppression) return false;
    return _playbackActive || _now().isBefore(_cooldownUntil);
  }

  void updateRoute(AudioOutputRoute route) {
    _route = route;
    if (!route.requiresAcousticEchoSuppression) {
      _cooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);
    }
  }

  void beginPlayback() {
    _playbackActive = true;
  }

  void endPlayback() {
    _playbackActive = false;
    _cooldownUntil = _route.requiresAcousticEchoSuppression
        ? _now().add(cooldown)
        : DateTime.fromMillisecondsSinceEpoch(0);
  }

  void reset() {
    _playbackActive = false;
    _cooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);
  }
}
