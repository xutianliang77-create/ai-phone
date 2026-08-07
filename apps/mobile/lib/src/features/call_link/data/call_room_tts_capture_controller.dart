import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as livekit;

import 'call_room_capture_options.dart';
import 'call_room_client.dart';
import 'call_room_tts_capture_gate.dart';

class CallRoomTtsCaptureController {
  final CallRoomTtsCaptureGate _gate = CallRoomTtsCaptureGate();
  final Set<String> _gatedSegments = <String>{};
  final Set<String> _activePlaybacks = <String>{};
  final Map<String, int> _latestPlaybackGenerations = <String, int>{};
  final Map<String, Timer> _fallbackTimers = <String, Timer>{};
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

  Future<void> onPlaybackStarted({
    required livekit.Room room,
    required String playbackId,
    int? generation,
    int? audioDurationMs,
    required bool fullDuplexEnabled,
    required bool duplexDegraded,
    required void Function(bool enabled) onMicrophoneChanged,
  }) async {
    if (fullDuplexEnabled && !duplexDegraded) return;
    if (!_acceptGeneration(playbackId, generation)) return;
    _room = room;
    _activePlaybacks.add(playbackId);
    _fallbackTimers.remove(playbackId)?.cancel();
    final fallbackMs = (audioDurationMs ?? 2000).clamp(200, 30000) +
        _gate.cooldown.inMilliseconds +
        1000;
    _fallbackTimers[playbackId] = Timer(
      Duration(milliseconds: fallbackMs),
      () => unawaited(onPlaybackFinished(
        room: room,
        playbackId: playbackId,
        generation: generation,
        fullDuplexEnabled: fullDuplexEnabled,
        duplexDegraded: duplexDegraded,
        onMicrophoneChanged: onMicrophoneChanged,
      )),
    );
    final localGeneration = ++_generation;
    try {
      await room.localParticipant?.setMicrophoneEnabled(false);
    } catch (_) {
      return;
    }
    if (_room != room || localGeneration != _generation) return;
    onMicrophoneChanged(false);
  }

  Future<void> onPlaybackFinished({
    required livekit.Room room,
    required String playbackId,
    int? generation,
    required bool fullDuplexEnabled,
    required bool duplexDegraded,
    required void Function(bool enabled) onMicrophoneChanged,
  }) async {
    if (fullDuplexEnabled && !duplexDegraded) return;
    if (!_acceptGeneration(playbackId, generation)) return;
    _fallbackTimers.remove(playbackId)?.cancel();
    _activePlaybacks.remove(playbackId);
    if (_activePlaybacks.isNotEmpty) return;
    _gate.holdCooldown();
    final localGeneration = ++_generation;
    _timer?.cancel();
    _timer = Timer(
      _gate.remaining,
      () => unawaited(_restore(room, localGeneration, onMicrophoneChanged)),
    );
  }

  void reset() {
    _generation += 1;
    _timer?.cancel();
    _timer = null;
    for (final timer in _fallbackTimers.values) {
      timer.cancel();
    }
    _fallbackTimers.clear();
    _activePlaybacks.clear();
    _latestPlaybackGenerations.clear();
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
    if (_activePlaybacks.isNotEmpty) return;
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

  bool _acceptGeneration(String playbackId, int? generation) {
    if (generation == null) return true;
    final latest = _latestPlaybackGenerations[playbackId];
    if (latest != null && generation < latest) return false;
    if (latest != null &&
        generation == latest &&
        !_activePlaybacks.contains(playbackId)) {
      return false;
    }
    if (latest != null && generation > latest) {
      _activePlaybacks.remove(playbackId);
      _fallbackTimers.remove(playbackId)?.cancel();
    }
    _latestPlaybackGenerations[playbackId] = generation;
    return true;
  }
}
