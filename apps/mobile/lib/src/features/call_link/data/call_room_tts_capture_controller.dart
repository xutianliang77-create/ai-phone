import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as livekit;

import 'call_room_capture_options.dart';
import 'call_room_client.dart';
import 'call_room_tts_capture_gate.dart';

class CallRoomTtsCaptureController {
  final CallRoomTtsCaptureGate _gate = CallRoomTtsCaptureGate();
  final Set<String> _gatedSegments = <String>{};
  Timer? _timer;
  livekit.Room? _room;
  int _generation = 0;

  Future<void> blockFor({
    required livekit.Room room,
    required CallRoomCaption caption,
    required bool fullDuplexEnabled,
    required bool duplexDegraded,
    required void Function(bool enabled) onMicrophoneChanged,
  }) async {
    if (fullDuplexEnabled && !duplexDegraded) return;
    if (!_gatedSegments.add(caption.segmentId)) return;
    if (_gatedSegments.length > 100) {
      _gatedSegments.remove(_gatedSegments.first);
    }
    _room = room;
    final playbackMs = caption.audioDurationMs!.clamp(200, 30000);
    final remaining = _gate.blockFor(Duration(milliseconds: playbackMs));
    final generation = ++_generation;
    _timer?.cancel();
    try {
      await room.localParticipant?.setMicrophoneEnabled(false);
    } catch (_) {
      return;
    }
    if (_room != room || generation != _generation) return;
    onMicrophoneChanged(false);
    _timer = Timer(
      remaining,
      () => unawaited(_restore(room, generation, onMicrophoneChanged)),
    );
  }

  void reset() {
    _generation += 1;
    _timer?.cancel();
    _timer = null;
    _room = null;
    _gate.reset();
    _gatedSegments.clear();
  }

  Future<void> _restore(
    livekit.Room room,
    int generation,
    void Function(bool enabled) onMicrophoneChanged,
  ) async {
    if (_room != room || generation != _generation) return;
    final remaining = _gate.remaining;
    if (remaining > Duration.zero) {
      _timer = Timer(
        remaining,
        () => unawaited(_restore(room, generation, onMicrophoneChanged)),
      );
      return;
    }
    try {
      await room.localParticipant?.setMicrophoneEnabled(
        true,
        audioCaptureOptions: callRoomAudioCaptureOptions,
      );
    } catch (_) {
      return;
    }
    if (_room == room && generation == _generation) {
      onMicrophoneChanged(true);
    }
  }
}
